import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execute, sandboxFailed, cliArgs } from '../server/cli';
import { defaults } from '../lib/domain';
test('サンドボックスの起動失敗をレビュー失敗として見分ける', () => {
    assert.equal(sandboxFailed('exited -1 in 0ms:\nFailed to create unified exec process: CreateProcessWithLogonW failed: 1909'), true);
    assert.equal(sandboxFailed('runner failed during SpawnChild: CreateProcessAsUserW failed: 5'), true);
    assert.equal(sandboxFailed('## 総合判定：おおむね良好\n指摘は2件です。'), false);
});
test('実際の子プロセスでもAPI環境変数を外しstdinを閉じる', async () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'NEO_TEST_DUMMY';
    try {
        const output = await execute({ bin: process.execPath, prefix: [] }, ['-e', "process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({apiPresent:!!process.env.OPENAI_API_KEY,stdinEnded:true})))"], process.cwd(), undefined, undefined, undefined, 3000);
        assert.deepEqual(JSON.parse(output), { apiPresent: false, stdinEnded: true });
    }
    finally {
        if (previous === undefined)
            delete process.env.OPENAI_API_KEY;
        else
            process.env.OPENAI_API_KEY = previous;
    }
});
test('既に中断済みならCLIを起動しない', async () => {
    const controller = new AbortController();
    controller.abort();
    let started = false;
    await assert.rejects(() => execute({ bin: process.execPath, prefix: [] }, ['-e', 'setInterval(()=>{},1000)'], process.cwd(), undefined, () => { started = true; }, controller.signal), /中断しました/);
    assert.equal(started, false);
});
test('中断時はWindowsのtree終了が拒否されても自分の子プロセスを止める', async () => { const controller = new AbortController(); let child: import('node:child_process').ChildProcess | undefined; await assert.rejects(() => execute({ bin: process.execPath, prefix: [] }, ['-e', 'setInterval(()=>{},1000)'], process.cwd(), undefined, c => { child = c; setTimeout(() => controller.abort(), 40); }, controller.signal, 15000), /中断しました/); assert.ok(child?.exitCode !== null || child?.signalCode !== null); });

test('Codexは生成・レビューとも利用者の設定を無視し、新しく起動する', () => {
    for (const readOnly of [false, true]) {
        const args = cliArgs({ provider: 'codex', model: 'gpt-6.1-sol', depth: 'auto' }, '詳細', defaults, 'C:/request', '指示', readOnly);
        assert.equal(args[0], 'exec');
        // 利用者の config.toml（Windowsのサンドボックス設定など）が無いと Codex がファイルを読み書きできないため、--ignore-user-config は付けない
        assert.ok(!args.includes('--ignore-user-config'));
        assert.equal(args[args.indexOf('--sandbox') + 1], readOnly ? 'read-only' : 'workspace-write');
        assert.ok(!args.includes('resume'));
    }
});
test('Windows：.cmd が実行ファイル（.exe）を呼ぶ形でも見つけ、拡張子なしのsh用スクリプトは使わない', { skip: process.platform !== 'win32' }, async () => {
    const { locate } = await import('../server/cli');
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-locate-'));
    const previous = process.env.PATH;
    try {
        await fs.mkdir(path.join(dir, 'node_modules', 'tool', 'bin'), { recursive: true });
        await fs.writeFile(path.join(dir, 'node_modules', 'tool', 'bin', 'neotool.exe'), '');
        await fs.writeFile(path.join(dir, 'neotool.cmd'), '@ECHO off\r\n"%dp0%\\node_modules\\tool\\bin\\neotool.exe"   %*\r\n');
        await fs.writeFile(path.join(dir, 'neotool'), '#!/bin/sh\n');
        process.env.PATH = dir;
        const found = await locate('neotool');
        assert.equal(found?.bin, path.join(dir, 'node_modules', 'tool', 'bin', 'neotool.exe'));
        await fs.rm(path.join(dir, 'neotool.cmd'));
        assert.equal(await locate('neotool'), null);
    } finally {
        process.env.PATH = previous;
        await fs.rm(dir, { recursive: true, force: true });
    }
});
