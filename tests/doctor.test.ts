import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { aiChecks, exitCode, nodeSupported, report, writable, type Check } from '../scripts/doctor';

test('Nodeの最小バージョン20.9を境界で判定する', () => {
    for (const version of ['20.9.0', 'v20.9.1', '22.0.0', '24.22.1']) assert.equal(nodeSupported(version), true, version);
    for (const version of ['18.20.8', '20.8.99', 'invalid', '20.9.0-rc.1']) assert.equal(nodeSupported(version), false, version);
});
test('AIは片方だけ使えれば必須条件を満たし、両方使えない時だけ失敗する', () => {
    for (const claude of [false, true]) for (const codex of [false, true]) {
        const checks = aiChecks({ claude: { installed: true, usable: claude, message: 'Claudeの状態' }, codex: { installed: true, usable: codex, message: 'Codexの状態' } });
        assert.equal(exitCode(checks), claude || codex ? 0 : 1);
        assert.match(report(checks), /APIキーでのログインは不可/);
        if (!codex) assert.match(report(checks), /npm install -g @openai\/codex/);
    }
});
test('任意項目は失敗にせず、必須の不足は失敗にし、対処は不足時だけ出す', () => {
    const optional: Check = { label: 'Office', status: '任意', required: false, detail: '未検出', remedy: '導入方法' };
    assert.equal(exitCode([optional]), 0);
    assert.doesNotMatch(report([optional]), /対処/);
    const required: Check = { label: 'Python', status: '不足', required: true, detail: '未検出', remedy: 'インストール' };
    assert.equal(exitCode([optional, required]), 1);
    assert.match(report([required]), /不足：Python.*\n  対処：インストール/);
    assert.doesNotMatch(report([{ ...required, status: '合格' }]), /対処/);
});
test('書き込み確認は既存ファイルを保持し、一時ファイルを残さない', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-doctor-test-'));
    try {
        await fs.writeFile(path.join(dir, 'keep.txt'), '保持');
        assert.equal(await writable(dir), true);
        assert.deepEqual(await fs.readdir(dir), ['keep.txt']);
        assert.equal(await fs.readFile(path.join(dir, 'keep.txt'), 'utf8'), '保持');
        assert.equal(await writable(path.join(dir, 'keep.txt')), false);
        assert.equal(await writable(path.join(dir, 'new-workspace')), true);
        assert.deepEqual(await fs.readdir(path.join(dir, 'new-workspace')), []);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
