import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { create, act, current, list, minutesProtocol } from '../server/runner';
import { requestDir, safeFile, save, readRecord } from '../server/store';
import { guard, token } from '../server/http';
import { defaults, type Input, type RecordData } from '../lib/domain';
process.env.NEO_FAKE_AI = '1';
process.env.NEO_FAKE_DELAY_MS = '30';
const input: Input = { title: '自動テスト', audience: '社内', purpose: '報告', formats: ['html'], level: '簡易', palette: '026', brand: '#225966', material: '架空のテスト素材です', ai: { provider: 'claude', model: 'opus', depth: 'auto' } };
async function waitFor(id: string, status: string) {
    for (let n = 0; n < 400; n++) {
        const r = await current(id);
        if (r.status === status)
            return r;
        if (r.status === 'error' && status !== 'error')
            assert.fail(r.error);
        await delay(10);
    }
    assert.fail('状態待ちがタイムアウトしました：' + status);
}
test('偽AIの全段階・履歴・配信範囲・中断再開を通す', async () => {
    const simple = await create(input, []);
    const done = await waitFor(simple.id, 'done');
    assert.equal(done.review, '');
    assert.ok(done.check);
    assert.ok(done.files.includes('index.html'));
    const dir = requestDir(done.id);
    assert.match(await fs.readFile(path.join(dir, 'request.md'), 'utf8'), /版：簡易/);
    assert.equal((await fs.readFile(path.join(dir, 'material.md'), 'utf8')).trim(), input.material);
    assert.ok((await list()).some(r => r.id === done.id));
    await assert.rejects(() => safeFile(done.id, ['..', '..', 'settings.json']));
    await assert.rejects(() => safeFile(done.id, ['state.json']));
    assert.ok(await safeFile(done.id, ['index.html']));
    const detailed = await create({ ...input, level: '詳細', formats: ['pptx', 'html'], palette: 'auto' }, []);
    let design = await waitFor(detailed.id, 'design');
    assert.deepEqual(design.paletteCandidates, ['026', '001', '079']);
    assert.equal(design.fake, true);
    process.env.NEO_FAKE_AI = '0';
    try {
        await assert.rejects(() => act(design.id, 'approve'), /同じモード/);
    }
    finally {
        process.env.NEO_FAKE_AI = '1';
    }
    assert.equal(design.files.includes('slides.pptx'), false);
    await act(design.id, 'design-revise', { feedback: '比較を2案にする' });
    design = await waitFor(design.id, 'design');
    assert.match(design.design, /比較を2案にする/);
    await act(design.id, 'approve', { palette: '001' });
    const complete = await waitFor(design.id, 'done');
    assert.equal(complete.chosenPalette, '001');
    assert.match(complete.review, /Codex/);
    assert.ok(complete.files.includes('slides.pptx'));
    assert.ok(complete.timings['手直し'] !== undefined);
    await act(complete.id, 'revise', { feedback: '見出しを短く' });
    const revised = await waitFor(complete.id, 'done');
    assert.equal(revised.revisionUsed, true);
    await assert.rejects(() => act(complete.id, 'revise', { feedback: 'もう一度' }));
    for (const audience of ['社内', '社外'] as const) {
        const auto = await create({ ...input, level: 'AUTO', audience }, []);
        let r = await waitFor(auto.id, audience === '社外' ? 'design' : 'done');
        assert.equal(r.selectedLevel, audience === '社外' ? '詳細' : '簡易');
        assert.ok(r.reason);
        if (audience === '社外') {
            await act(r.id, 'approve');
            await waitFor(r.id, 'done');
        }
    }
    const q = await create({ ...input, material: '[question] 架空素材' }, []);
    const asked = await waitFor(q.id, 'question');
    assert.equal(asked.asked, true);
    await act(q.id, 'stop');
    assert.equal((await current(q.id)).status, 'stopped');
    await act(q.id, 'resume');
    assert.equal((await current(q.id)).status, 'question');
    await act(q.id, 'answer', { answer: asked.question!.options[0] });
    const answered = await waitFor(q.id, 'done');
    assert.match(answered.design, /A：今月/);
    const err = await create({ ...input, material: '[error] 架空素材' }, []);
    const failed = await waitFor(err.id, 'error');
    assert.ok(failed.design);
    await act(err.id, 'switch');
    const resumed = await waitFor(err.id, 'done');
    assert.equal(resumed.input.ai.provider, 'codex');
    assert.equal(resumed.attempt, 1);
    process.env.NEO_FAKE_DELAY_MS = '100';
    const stop = await create(input, []);
    await act(stop.id, 'stop');
    assert.equal((await current(stop.id)).status, 'stopped');
    await act(stop.id, 'resume');
    await waitFor(stop.id, 'done');
    const attachment = new File(['素材'], '../../危険.txt', { type: 'text/plain' });
    const attached = await create({ ...input, material: '' }, [attachment]);
    const attachmentDone = await waitFor(attached.id, 'done');
    const savedFiles = await fs.readdir(path.join(requestDir(attached.id), 'attachments'));
    assert.equal(savedFiles.length, 1);
    assert.ok(!savedFiles[0].includes('..'));
});
test('ローカルAPIのOrigin・token検証', () => { assert.throws(() => guard(new Request('http://127.0.0.1:3210/api/neo', { headers: { host: '127.0.0.1:3210', origin: 'https://example.com' } }))); assert.throws(() => guard(new Request('http://127.0.0.1:3210/api/neo', { method: 'POST', headers: { host: '127.0.0.1:3210' } }), true)); assert.doesNotThrow(() => guard(new Request('http://127.0.0.1:3210/api/neo', { method: 'POST', headers: { host: '127.0.0.1:3210', 'x-neo-token': token } }), true)); assert.throws(() => guard(new Request('http://evil.example/api/neo', { headers: { host: 'evil.example' } }))); });

test('議事録：簡易は止めず、詳細は台帳の修正・承認後に独立レビューと手直し', async () => {
    const previous = process.env.NEO_BROWSER;
    process.env.NEO_BROWSER = 'none';
    try {
        const i: Input = { ...input, purpose: '議事録', palette: 'auto', material: '[question] 会議の架空素材' };
        const simple = await create(i, []);
        const done = await waitFor(simple.id, 'done');
        assert.equal(done.asked, false);
        assert.equal(done.review, '');
        assert.equal(done.paletteCandidates, undefined);
        assert.match(done.pdfNote!, /PDFは作れませんでした（Chrome か Edge が必要）/);
        assert.ok(done.logs.some(line => line.includes(done.pdfNote!)));
        assert.deepEqual(done.files.sort(), ['ledger.md', 'minutes.md']);
        assert.match(done.minutes!, /\| 担当 \| 内容 \| 期限 \|/);
        for (const text of ['冒頭情報', '決定事項', '宿題', '論点と経緯', '次回の確認事項', '「計画を確認します」', 'xx', '（未確認）', '未確認事項']) assert.ok(done.minutes!.includes(text));
        assert.ok(await safeFile(done.id, ['minutes.md']));
        assert.ok(await safeFile(done.id, ['ledger.md']));
        for (const file of ['design.md', 'question.json', 'palette-candidates.json', 'index.html', 'slides.pptx', 'preview']) await assert.rejects(fs.stat(path.join(requestDir(done.id), file)));
        const detailed = await create({ ...i, level: '詳細' }, []);
        let design = await waitFor(detailed.id, 'design');
        assert.match(design.design, /台帳/);
        assert.equal(design.minutes, '');
        assert.equal(design.paletteCandidates, undefined);
        await act(design.id, 'design-revise', { feedback: '期限の不明点を確認' });
        design = await waitFor(design.id, 'design');
        assert.match(design.design, /期限の不明点を確認/);
        await act(design.id, 'approve');
        const complete = await waitFor(design.id, 'done');
        assert.equal(complete.reviewer, 'codex');
        assert.match(complete.review, /経緯の飛躍/);
        assert.ok(complete.timings['レビュー'] !== undefined && complete.timings['手直し'] !== undefined);
        const firstMinutes = complete.minutes;
        await fs.writeFile(path.join(requestDir(complete.id), 'minutes.pdf'), '%PDF-stale');
        await act(complete.id, 'revise', { feedback: '決定事項を確認' });
        const revised = await waitFor(complete.id, 'done');
        assert.equal(revised.revisionUsed, true);
        assert.notEqual(revised.minutes, firstMinutes);
        assert.ok(revised.pdfNote);
        assert.ok(!revised.files.includes('minutes.pdf'));
        await assert.rejects(fs.stat(path.join(requestDir(complete.id), 'minutes.pdf')));
        assert.match(await fs.readFile(path.join(requestDir(complete.id), 'revision.md'), 'utf8'), /決定事項を確認/);
        // The legacy purpose is kept for display and continues to use the slide path.
        const old = { ...done, input: { ...done.input, purpose: '会議まとめ' } } as unknown as RecordData;
        await save(old);
        assert.equal((await readRecord(old.id)).input.purpose, '会議まとめ');
        assert.ok((await list()).some(r => r.id === old.id));
        for (const stage of ['設計図', '本番', '検査', 'レビュー', '手直し'] as const) {
            const protocol = minutesProtocol(complete, stage, 'request', 'prompts');
            assert.doesNotMatch(protocol, /スライド|pptx|HTML|preview|配色|design\.md|evidence\.md|icons\.md|interactive\.md/);
            assert.match(protocol, /meeting\.md/);
            assert.match(protocol, /minutes\.md/);
        }
    } finally { if (previous === undefined) delete process.env.NEO_BROWSER; else process.env.NEO_BROWSER = previous; }
});
