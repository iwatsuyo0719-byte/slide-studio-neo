import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { create, current, act, minutesProtocol } from '../server/runner';
import { save, requestDir } from '../server/store';
import { minutesStages, type Input, type RecordData } from '../lib/domain';

process.env.NEO_FAKE_AI = '1';
process.env.NEO_FAKE_DELAY_MS = '10';
process.env.NEO_BROWSER = 'none';
const input: Input = { title: '起動回数', audience: '社内', purpose: '議事録', formats: ['html'], level: '詳細', palette: '', brand: '', material: '会議：計画を確認します', ai: { provider: 'codex', model: 'gpt-6.1-sol', depth: 'auto' } };
async function wait(id: string, status: RecordData['status']) {
    for (let n = 0; n < 500; n++) {
        const r = await current(id);
        if (r.status === status) return r;
        if (r.status === 'error') assert.fail(r.error);
        await delay(10);
    }
    assert.fail('タイムアウト：' + status);
}

test('偽AI：社内1回・社外2回、段階・timings・生成物・機械検査を確認', async () => {
    for (const audience of ['社内', '社外'] as const) {
        const r = await wait((await create({ ...input, audience }, [])).id, 'done');
        assert.deepEqual(Object.keys(r.timings), minutesStages({ audience }));
        assert.equal(r.logs.filter(l => /いまの段階：(作る|レビュー)$/.test(l)).length, audience === '社内' ? 1 : 2);
        assert.equal(!!r.reviewed, audience === '社外');
        assert.equal(r.stage, 'PDF');
        for (const name of ['ledger.md', 'minutes.md', 'check.md', 'check-auto.json', 'check-auto.md', ...(audience === '社外' ? ['review.md', 'revision.md'] : [])]) {
            assert.ok((await fs.stat(path.join(requestDir(r.id), name))).size);
        }
        if (audience === '社内') await assert.rejects(fs.stat(path.join(requestDir(r.id), 'review.md')));
        assert.ok(!r.files.includes('check-auto.json'));
    }
});

test('偽AI：作る段の停止・再開と、社内の不合格通知', async () => {
    const failed = await wait((await create({ ...input, material: '[error] 会議' }, [])).id, 'error');
    assert.equal(failed.resumeStage, '作る');
    await fs.writeFile(path.join(requestDir(failed.id), 'ledger.md'), '途中の台帳');
    failed.attempt = 1;
    await save(failed);
    const protocol = minutesProtocol(failed, '作る', 'request', 'prompts', false, 'rules-作る.md');
    assert.match(protocol, /ledger.md・minutes.md が既にあれば読み、続きから仕上げ/);
    await act(failed.id, 'resume');
    const done = await wait(failed.id, 'done');
    assert.match(done.minutesCheckNote!, /引用/);
    assert.ok(done.logs.some(l => l.includes(done.minutesCheckNote!)));
    assert.equal(done.timings.レビュー, undefined);
});

test('偽AI：社外レビュー失敗から再開して作るAIは起動し直さない', async () => {
    const failed = await wait((await create({ ...input, audience: '社外', material: '[review-error] 会議' }, [])).id, 'error');
    assert.equal(failed.resumeStage, 'レビュー');
    const creation = failed.timings.作る;
    await fs.appendFile(path.join(requestDir(failed.id), 'minutes.md'), '\n手で保持した本文');
    failed.attempt = 1;
    await save(failed);
    await act(failed.id, 'resume');
    const done = await wait(failed.id, 'done');
    assert.equal(done.timings.作る, creation);
    assert.equal(done.logs.filter(l => /いまの段階：作る$/.test(l)).length, 1);
    assert.match(done.minutes!, /手で保持した本文/);
    assert.equal(done.reviewed, true);
});

test('旧議事録の各段階から新しい流れへ再開できる', async () => {
    for (const stage of ['設計図', '本番', '検査', 'レビュー', '手直し'] as const) {
        const r = await wait((await create(input, [])).id, 'done');
        r.status = 'stopped'; r.stage = r.resumeStage = stage; r.timings = {};
        await save(r);
        await act(r.id, 'resume');
        const done = await wait(r.id, 'done');
        assert.deepEqual(Object.keys(done.timings), ['作る', 'PDF']);
    }
});
