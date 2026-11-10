import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { resolveWorkspace, workspace, requests, settings, history, sample, requestDir, readRecord, artifacts } from '../server/store';

test('作業場所は環境変数を優先し、相対パスはcwdから解決する', () => {
    const home = path.join(os.tmpdir(), 'neo-home');
    const data = path.join(home, 'data');
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
        assert.equal(resolveWorkspace({ NEO_WORKSPACE: data, LOCALAPPDATA: 'ignored', XDG_DATA_HOME: 'ignored' }, platform, home), data);
        assert.equal(resolveWorkspace({ NEO_WORKSPACE: 'relative-work' }, platform, home), path.resolve('relative-work'));
    }
    assert.equal(resolveWorkspace({ LOCALAPPDATA: data }, 'win32', home), path.join(data, 'slide-studio-neo'));
    assert.equal(resolveWorkspace({}, 'win32', home), path.join(home, 'AppData', 'Local', 'slide-studio-neo'));
    for (const platform of ['linux', 'darwin'] as const) {
        assert.equal(resolveWorkspace({ XDG_DATA_HOME: data }, platform, home), path.join(data, 'slide-studio-neo'));
        assert.equal(resolveWorkspace({ XDG_DATA_HOME: '' }, platform, home), path.join(home, '.local', 'share', 'slide-studio-neo'));
    }
});

test('storeはimport前に指定した一時フォルダに設定と実績を保存する', async () => {
    assert.equal(workspace, process.env.NEO_WORKSPACE);
    assert.equal(path.dirname(workspace), os.tmpdir());
    assert.equal(requests, path.join(workspace, 'requests'));
    await settings();
    assert.ok(await fs.stat(path.join(workspace, 'settings.json')));
    const previous = process.env.NEO_FAKE_AI;
    try {
        for (const fake of ['0', '1']) {
            process.env.NEO_FAKE_AI = fake;
            const entry = { key: 'test', phase: 'design' as const, ms: 123 };
            await sample(entry);
            assert.deepEqual(await history(), [entry]);
            assert.ok(await fs.stat(path.join(workspace, fake === '1' ? 'history.fake.json' : 'history.json')));
        }
    } finally {
        if (previous === undefined) delete process.env.NEO_FAKE_AI;
        else process.env.NEO_FAKE_AI = previous;
    }
});

test('旧reviewerの保存データを読み、新しいreviewedを優先してレビュー表示する', async () => {
    for (const reviewed of [undefined, false, true]) {
        const id = '2026-11-10-legacy-' + String(reviewed);
        const dir = requestDir(id);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'review.md'), '# 旧レビュー');
        await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({ id, input: { purpose: '報告' }, reviewer: 'claude', reviewFallback: true, reviewed }));
        const record = await readRecord(id);
        assert.equal(record.reviewed, reviewed ?? true);
        assert.ok(!('reviewer' in record) && !('reviewFallback' in record));
        await artifacts(record);
        assert.equal(record.review, reviewed === false ? '' : '# 旧レビュー');
    }
});
