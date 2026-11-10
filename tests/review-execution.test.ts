import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { create, current, act } from '../server/runner';
import { readRecord, save } from '../server/store';
import type { RecordData } from '../lib/domain';

process.env.NEO_BROWSER = 'none';
process.env.NEO_FAKE_DELAY_MS = '1';
async function waitFor(id: string, predicate: (r: RecordData) => boolean) {
    for (let n = 0; n < 1000; n++) {
        const r = await current(id);
        if (r.status === 'error') assert.fail(r.error);
        if (predicate(r)) return r;
        await delay(5);
    }
    assert.fail('レビュー実行待ちタイムアウト');
}

test('実CLI境界：エラー終了・空白応答・stderrだけなら独立したread-only Claudeへ切り替える', async t => {
    const stat = fs.stat;
    t.mock.method(fs, 'stat', async (...args: Parameters<typeof fs.stat>) => {
        if (/(?:claude|codex)(?:\.exe)?$/.test(String(args[0]))) return { isFile: () => true } as Awaited<ReturnType<typeof fs.stat>>;
        return stat(...args);
    });
    let mode = 'exit-error';
    let calls: { provider: string; args: string[] }[] = [];
    const read = fs.readFile.bind(fs);
    t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
        const value = await read(...args);
        return mode === 'empty' && /prompts[/\\]README.md$/.test(String(args[0])) ? String(value).replace('目的が議事録なら', '未知の用途なら') : value;
    });
    t.mock.method(childProcess, 'spawn', (bin: string, args: string[], options: childProcess.SpawnOptions) => {
        const child = new EventEmitter() as childProcess.ChildProcess;
        Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => { child.emit('close', null); return true; } });
        const provider = path.basename(bin).startsWith('codex') ? 'codex' : 'claude';
        calls.push({ provider, args });
        setTimeout(() => { void (async () => {
            const emit = (text: string, code = 0, err = '') => { child.stdout!.emit('data', text); if (err) child.stderr!.emit('data', err); child.emit('close', code); };
            if (args[0] === 'login') return emit('Logged in using ChatGPT');
            if (args[0] === 'auth') return emit(args[1] === '--help' ? 'status' : JSON.stringify({ loggedIn: true, authMethod: 'oauth' }));
            const protocol = args[0] === 'exec' ? args.at(-1)! : args[1];
            const stage = protocol.match(/段階：([^。]+)/)![1];
            if (mode === 'empty') assert.match(protocol, /README.md/);
            else {
                assert.ok(protocol.includes('rules-' + stage + '.md'));
                assert.doesNotMatch(protocol, /README.md/);
                assert.match(await fs.readFile(path.join(String(options.cwd), 'rules-' + stage + '.md'), 'utf8'), /出典：minutes.md/);
            }
            if (protocol.includes('段階：レビュー')) {
                if (mode === 'cancel' && provider === 'codex') return;
                if (mode === 'both-error' || mode === 'exit-error' && provider === 'codex') return emit('', 1, 'CreateProcessWithLogonW 267');
                if (provider === 'codex') return mode === 'empty' ? emit('  \n\t') : emit('', 0, 'CLI progress, no review output');
                return emit('# Claude Code独立レビュー\n総合判定：確認済み');
            }
            await fs.writeFile(path.join(String(options.cwd), 'revision.md'), 'レビューに基づく手直し');
            await fs.appendFile(path.join(String(options.cwd), 'minutes.md'), '\n手直し済み');
            emit('手直しを実施');
        })().catch(e => { child.stderr!.emit('data', String(e)); child.emit('close', 1); }); }, 5);
        return child;
    });
    syncBuiltinESMExports();
    try {
        for (mode of ['exit-error', 'empty', 'stderr-only', 'both-error', 'cancel']) {
            process.env.NEO_FAKE_AI = '1';
            const initial = await create({ title: 'CLIレビュー境界', audience: '社内', purpose: '議事録', formats: ['html'], level: '詳細', palette: '', brand: '', material: '会議記録', ai: { provider: 'claude', model: 'opus', depth: 'auto' } }, []);
            await waitFor(initial.id, r => r.status === 'done');
            const r = await readRecord(initial.id);
            r.fake = false; r.status = 'stopped'; r.stage = r.resumeStage = 'レビュー';
            delete r.timings['手直し'];
            await save(r);
            process.env.NEO_FAKE_AI = '0';
            calls = [];
            await act(r.id, 'resume');
            if (mode === 'cancel') {
                await waitFor(r.id, r => r.reviewer === 'codex' && r.stage === 'レビュー');
                const stopped = await act(r.id, 'stop');
                assert.equal(stopped.status, 'stopped');
                assert.equal(stopped.reviewFallback, false);
                assert.ok(!calls.some(c => c.provider === 'claude' && c.args.includes('-p')));
                continue;
            }
            const completed = await waitFor(r.id, r => r.status === 'done');
            assert.equal(completed.reviewFallback, true);
            if (mode === 'empty') assert.ok(completed.logs.some(l => l.includes('READMEを読む指示に戻します')));
            const reviewCalls = calls.filter(c => c.args.some(a => a.includes('段階：レビュー')));
            assert.deepEqual(reviewCalls.map(c => c.provider), ['codex', 'claude']);
            assert.equal(reviewCalls[0].args[reviewCalls[0].args.indexOf('--sandbox') + 1], 'read-only');
            const claude = reviewCalls[1].args;
            assert.equal(claude[claude.indexOf('--tools') + 1], 'Read');
            assert.equal(claude[claude.indexOf('--permission-mode') + 1], 'dontAsk');
            assert.ok(!claude.some(a => /^(?:Write|Edit|Bash)\(/.test(a)));
            assert.ok(!claude.includes('--resume') && !claude.includes('--continue'));
            assert.equal(completed.reviewer, mode === 'both-error' ? undefined : 'claude');
            if (mode === 'both-error') {
                assert.equal(completed.review, '');
                assert.equal(completed.timings['手直し'], undefined);
                assert.match(completed.reviewNote!, /レビューなし/);
            } else {
                assert.match(completed.review, /Codexレビュー未実施/);
                assert.match(completed.review, /総合判定：確認済み/);
                assert.ok(completed.timings['手直し']);
            }
        }
    } finally {
        process.env.NEO_FAKE_AI = '1';
        t.mock.restoreAll(); syncBuiltinESMExports();
    }
});
