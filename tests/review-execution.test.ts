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
        if (predicate(r)) return r;
        if (r.status === 'error') assert.fail(r.error);
        await delay(5);
    }
    assert.fail('レビュー実行待ちタイムアウト');
}

test('CLI境界（起動はモック）：議事録は同じAIでレビューと直し、スライドはread-only', async t => {
    const stat = fs.stat;
    t.mock.method(fs, 'stat', async (...args: Parameters<typeof fs.stat>) => {
        if (/(?:claude|codex)(?:\.exe)?$/.test(String(args[0]))) return { isFile: () => true } as Awaited<ReturnType<typeof fs.stat>>;
        return stat(...args);
    });
    let mode = 'exit-error';
    let reviewChild: childProcess.ChildProcess | undefined;
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
                assert.match(await fs.readFile(path.join(String(options.cwd), 'rules-' + stage + '.md'), 'utf8'), /出典：/);
            }
            if (stage === '作る') {
                assert.match(protocol, /既にあれば読み、続きから仕上げ/);
                await fs.writeFile(path.join(String(options.cwd), 'check.md'), '保存済みの台帳・本文を読み自己確認');
                return emit('続きから仕上げました');
            }
            if (protocol.includes('段階：レビュー')) {
                if (mode === 'cancel') { reviewChild = child; return; }
                if (mode === 'exit-error') return emit('', 1, 'CreateProcessWithLogonW failed: 267');
                if (mode === 'sandbox') return emit('判定保留', 0, 'Failed to create unified exec process');
                if (mode === 'empty') return emit('  \n\t');
                if (mode === 'stderr-only') return emit('', 0, 'CLI progress, no review output');
                if (protocol.includes('check-auto.md')) {
                    await fs.writeFile(path.join(String(options.cwd), 'review.md'), '# 独立レビュー\n総合判定：確認済み');
                    await fs.writeFile(path.join(String(options.cwd), 'revision.md'), 'レビューで修正');
                    const latest = await fs.readFile(path.join(String(options.cwd), 'minutes.md'), 'utf8');
                    await fs.writeFile(path.join(String(options.cwd), 'minutes.md'), latest + '\nレビューで修正済み');
                    await fs.writeFile(path.join(String(options.cwd), 'check.md'), '確認済み');
                }
                return emit('# 独立レビュー\n総合判定：確認済み');
            }
            await fs.writeFile(path.join(String(options.cwd), 'revision.md'), 'レビューに基づく手直し');
            await fs.appendFile(path.join(String(options.cwd), 'minutes.md'), '\n手直し済み');
            emit('手直しを実施');
        })().catch(e => { child.stderr!.emit('data', String(e)); child.emit('close', 1); }); }, 5);
        return child;
    });
    syncBuiltinESMExports();
    try {
        for (const purpose of ['議事録', '報告'] as const) {
            for (const provider of ['claude', 'codex'] as const) {
                for (mode of ['success', 'creation-resume', 'exit-error', 'empty', 'stderr-only', 'sandbox', 'cancel']) {
                    if (purpose === '報告' && mode !== 'success') continue;
                    if (mode === 'sandbox' && provider !== 'codex') continue;
                    process.env.NEO_FAKE_AI = '1';
                    const initial = await create({ title: 'CLIレビュー境界', audience: '社外', purpose, formats: ['html'], level: '詳細', palette: '026', brand: '', material: '会議記録', ai: { provider, model: provider === 'claude' ? 'opus' : 'gpt-6.1-sol', depth: 'auto' } }, []);
                    if (purpose === '報告') {
                        await waitFor(initial.id, r => r.status === 'design');
                        await act(initial.id, 'approve');
                    }
                    await waitFor(initial.id, r => r.status === 'done');
                    const r = await readRecord(initial.id);
                    r.fake = false; r.status = 'stopped'; r.stage = r.resumeStage = mode === 'creation-resume' ? '作る' : 'レビュー';
                    delete r.timings['手直し'];
                    await save(r);
                    process.env.NEO_FAKE_AI = '0';
                    calls = [];
                    reviewChild = undefined;
                    await act(r.id, 'resume');
                    if (mode === 'cancel') {
                        await waitFor(r.id, r => r.stage === 'レビュー' && !!reviewChild);
                        const stopping = act(r.id, 'stop');
                        reviewChild!.emit('close', null);
                        const stopped = await stopping;
                        assert.equal(stopped.status, 'stopped');
                        assert.equal(stopped.reviewed, false);
                        assert.ok(calls.every(c => c.provider === provider));
                        continue;
                    }
                    const completed = await waitFor(r.id, r => r.status === (purpose === '議事録' && !['success', 'creation-resume'].includes(mode) ? 'error' : 'done'));
                    assert.equal(completed.reviewed, ['success', 'creation-resume'].includes(mode));
                    if (mode === 'creation-resume') assert.equal(calls.filter(c => c.args.some(a => a.includes('段階：作る'))).length, 1);
                    if (mode === 'empty') assert.ok(completed.logs.some(l => l.includes('READMEを読む指示に戻します')));
                    const reviewCalls = calls.filter(c => c.args.some(a => a.includes('段階：レビュー')));
                    assert.deepEqual(reviewCalls.map(c => c.provider), [provider]);
                    const args = reviewCalls[0].args;
                    const protocol = provider === 'codex' ? args.at(-1)! : args[1];
                    assert.match(protocol.split('\n')[0], /共通の開発ルール.*適用しません.*rules ファイルだけ/);
                    assert.ok(!args.includes('--resume') && !args.includes('--continue') && !args.includes('resume'));
                    if (provider === 'codex') {
                        assert.equal(args[args.indexOf('--sandbox') + 1], purpose === '議事録' ? 'workspace-write' : 'read-only');
                        assert.ok(!args.includes('--ignore-user-config'));
                    } else {
                        assert.equal(args[args.indexOf('--tools') + 1], purpose === '議事録' ? 'Read,Write,Edit' : 'Read');
                        assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
                        assert.equal(args.some(a => /^(?:Write|Edit)\(/.test(a)), purpose === '議事録');
                        assert.ok(!args.some(a => /^Bash\(/.test(a)));
                    }
                    assert.ok(calls.every(c => c.provider === provider));
                    if (!['success', 'creation-resume'].includes(mode)) {
                        assert.equal(completed.review, '');
                        assert.equal(completed.timings['手直し'], undefined);
                        assert.equal(completed.resumeStage, 'レビュー');
                        assert.equal(completed.status, 'error');
                    } else {
                        assert.match(completed.review, /総合判定：確認済み/);
                        assert.ok(completed.timings[purpose === '議事録' ? 'レビュー' : '手直し']);
                    }
                }
            }
        }
    } finally {
        process.env.NEO_FAKE_AI = '1';
        t.mock.restoreAll(); syncBuiltinESMExports();
    }
});
