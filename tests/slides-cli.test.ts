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
import { requestDir } from '../server/store';
import type { Input } from '../lib/domain';

process.env.NEO_FAKE_AI = '0';
process.env.NEO_INSPECT = '0';
const input: Input = { title: 'CLI起動統合', audience: '社内', purpose: '報告', formats: ['html', 'pptx'], level: '簡易', palette: '026', brand: '', material: 'https://docs.google.com/spreadsheets/d/example', ai: { provider: 'codex', model: 'gpt-6.1-sol', depth: 'high' } };
async function waitFor(id: string, status: string) {
    for (let n = 0; n < 1000; n++) {
        const r = await current(id);
        if (r.status === status) return r;
        if (r.status === 'error') assert.fail(r.error);
        await delay(5);
    }
    assert.fail('CLIモックの待機タイムアウト');
}

test('CLIモック：簡易は2回起動、AUTO詳細は承認後に本番。欠落・空・古い成果物はエラー', async t => {
    const stat = fs.stat;
    t.mock.method(fs, 'stat', async (...args: Parameters<typeof fs.stat>) => {
        if (/(?:claude|codex)(?:\.exe)?$/.test(String(args[0]))) return { isFile: () => true } as Awaited<ReturnType<typeof fs.stat>>;
        return stat(...args);
    });
    let selected = '簡易', fault = '', stages: string[] = [];
    t.mock.method(childProcess, 'spawn', (_bin: string, args: string[], options: childProcess.SpawnOptions) => {
        const child = new EventEmitter() as childProcess.ChildProcess;
        Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
        setTimeout(() => { void (async () => {
            const end = (text: string) => { child.stdout!.emit('data', text); child.emit('close', 0); };
            if (args[0] === 'login') return end('Logged in using ChatGPT');
            if (args[0] === 'auth') return end(args[1] === '--help' ? 'status' : JSON.stringify({ loggedIn: true, authMethod: 'oauth' }));
            const protocol = args[0] === 'exec' ? args.at(-1)! : args[1];
            const stage = protocol.match(/段階：([^。]+)/)![1];
            stages.push(stage);
            const dir = String(options.cwd);
            const put = (name: string, text: string) => fs.writeFile(path.join(dir, name), text);
            if (stage === '設計図') {
                await put('decision.json', JSON.stringify({ level: selected, reason: 'モック判定' }));
                await put('design.md', '## 売上の推移\n型06 E08\n数字台帳：未確認');
                if (selected === '簡易') {
                    assert.match(protocol, /同じ起動のまま本番/);
                    assert.match(protocol, /Google Driveの読み取り/);
                    assert.match(protocol, /60秒/);
                    assert.match(protocol, /プラグインのSkill.*読みません/);
                    assert.match(await fs.readFile(path.join(dir, 'rules-設計図.md'), 'utf8'), /## 描画寸法と色/);
                    await put('index.html', '<html>モック</html>');
                    if (fault !== 'missing') await put('slides.pptx', fault === 'empty' ? '' : 'pptx-mock');
                    if (fault === 'stale') await fs.utimes(path.join(dir, 'slides.pptx'), new Date(0), new Date(0));
                }
            } else if (stage === '本番') {
                await put('index.html', '<html>承認後</html>'); await put('slides.pptx', 'pptx-mock');
            } else if (stage === '検査') await put('check.md', '4点を確認');
            else if (stage === '手直し') await put('revision.md', '確認');
            end(stage === 'レビュー' ? '# レビュー\n問題なし' : '完了');
        })().catch(e => { child.stderr!.emit('data', String(e)); child.emit('close', 1); }); }, 5);
        return child;
    });
    syncBuiltinESMExports();
    try {
        for (const provider of ['codex', 'claude'] as const) {
            for (const level of ['簡易', 'AUTO'] as const) {
                stages = [];
                const r = await create({ ...input, level, ai: { ...input.ai, provider, model: provider === 'codex' ? 'gpt-6.1-sol' : 'opus' } }, []);
                await waitFor(r.id, 'done');
                assert.deepEqual(stages, ['設計図', '検査']);
            }
        }
        for (fault of ['missing', 'empty', 'stale']) {
            stages = [];
            const r = await create(input, []);
            const failed = await waitFor(r.id, 'error');
            assert.match(failed.error!, /slides.pptx/);
            assert.equal(failed.resumeStage, '設計図');
            assert.deepEqual(stages, ['設計図']);
            fault = '';
            await act(r.id, 'resume');
            const done = await waitFor(r.id, 'done');
            assert.ok(done.files.includes('slides.pptx'));
        }
        selected = '詳細'; stages = [];
        const r = await create({ ...input, level: 'AUTO' }, []);
        await waitFor(r.id, 'design');
        assert.deepEqual(stages, ['設計図']);
        await assert.rejects(fs.stat(path.join(requestDir(r.id), 'index.html')));
        await act(r.id, 'approve');
        await waitFor(r.id, 'done');
        assert.deepEqual(stages, ['設計図', '本番', '検査', 'レビュー', '手直し']);
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});
