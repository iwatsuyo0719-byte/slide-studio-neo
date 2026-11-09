import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { create, act, current, list, minutesProtocol } from '../server/runner';
import { requestDir, requests, safeFile, save, readRecord } from '../server/store';
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

test('議事録：全レベルで止まらず詳細・レビュー・手直し、手動保存とAI修正は最新本文を使う', async () => {
    const previous = process.env.NEO_BROWSER;
    process.env.NEO_BROWSER = 'none';
    try {
        const i: Input = { ...input, purpose: '議事録', palette: 'auto', material: '[question] 会議の架空素材' };
        for (const level of ['簡易', '詳細', 'AUTO'] as const) {
            const created = await create({ ...i, level }, []);
            await assert.rejects(() => act(created.id, 'save-minutes', { minutes: '生成中には保存不可' }), /実行中|完了した議事録/);
            const done = await waitFor(created.id, 'done');
            assert.equal(done.input.level, '詳細');
            assert.equal(done.selectedLevel, '詳細');
            assert.equal(done.phase, 'production');
            assert.equal(done.asked, false);
            assert.equal(done.reason, '');
            assert.equal(done.paletteCandidates, undefined);
            assert.equal(done.reviewer, 'codex');
            assert.match(done.review, /経緯の飛躍/);
            assert.ok(done.timings['レビュー'] !== undefined && done.timings['手直し'] !== undefined);
            assert.match(done.pdfNote!, /PDFは作れませんでした（Chrome か Edge が必要）/);
            assert.deepEqual(done.files.sort(), ['ledger.md', 'minutes.md']);
            for (const text of ['冒頭情報', '決定事項', '宿題', '論点と経緯', '次回の確認事項', '「計画を確認します」', 'xx', '（未確認）', '未確認事項']) assert.ok(done.minutes!.includes(text));
            for (const file of ['review.md', 'revision.md', 'minutes.md']) assert.ok((await fs.stat(path.join(requestDir(done.id), file))).size > 0);
            for (const file of ['design.md', 'decision.json', 'question.json', 'palette-candidates.json', 'index.html', 'slides.pptx', 'preview']) await assert.rejects(fs.stat(path.join(requestDir(done.id), file)));
            assert.ok(await safeFile(done.id, ['minutes.md']));
            assert.ok(await safeFile(done.id, ['ledger.md']));
            await assert.rejects(() => act(done.id, 'save-minutes', { minutes: 'a'.repeat(500001) }), /50万/);
            await assert.rejects(() => act(done.id, 'save-minutes', { minutes: null }), /50万/);
            const manual = done.minutes + '\n手動編集を保持する。\n';
            await fs.writeFile(path.join(requestDir(done.id), 'minutes.pdf'), '%PDF-stale');
            const saving = act(done.id, 'save-minutes', { minutes: manual, path: '../other.md' });
            await assert.rejects(() => act(done.id, 'save-minutes', { minutes: '重複保存' }), /処理中/);
            await assert.rejects(() => act(done.id, 'revise', { feedback: '同時操作' }), /処理中/);
            const saved = await saving;
            assert.equal(saved.minutes, manual);
            assert.equal(await fs.readFile(path.join(requestDir(done.id), 'minutes.md'), 'utf8'), manual);
            assert.equal(saved.status, 'done');
            assert.equal(saved.revisionUsed, false);
            assert.ok(saved.pdfNote);
            assert.ok(!saved.files.includes('minutes.pdf'));
            await assert.rejects(fs.stat(path.join(requestDir(done.id), 'minutes.pdf')));
            await act(done.id, 'revise', { feedback: '決定事項を確認' });
            await assert.rejects(() => act(done.id, 'save-minutes', { minutes: 'AI修正中' }), /実行中|完了した議事録/);
            const revised = await waitFor(done.id, 'done');
            assert.ok(revised.minutes!.startsWith(manual));
            assert.equal(revised.revisionUsed, true);
            assert.match(await fs.readFile(path.join(requestDir(done.id), 'revision.md'), 'utf8'), /決定事項を確認/);
            const final = revised.minutes + '\nAI修正後の手動編集。\n';
            assert.equal((await act(done.id, 'save-minutes', { minutes: final })).minutes, final);
            for (const stage of ['設計図', '本番', '検査', 'レビュー', '手直し'] as const) {
                const protocol = minutesProtocol(done, stage, 'request', 'prompts');
                assert.doesNotMatch(protocol, /スライド|pptx|HTML|preview|配色|design\.md|evidence\.md|icons\.md|interactive\.md/);
                assert.match(protocol, /meeting\.md/);
                assert.match(protocol, /minutes\.md/);
                if (stage === '手直し') assert.match(protocol, /最新の minutes\.md/);
            }
        }
        const slide = await create(input, []);
        await waitFor(slide.id, 'done');
        await assert.rejects(() => act(slide.id, 'save-minutes', { minutes: '拒否' }), /完了した議事録/);
        const created = await create(i, []);
        const old = await waitFor(created.id, 'done');
        // Previous simple/detailed completed records remain editable without migrating them.
        for (const level of ['簡易', '詳細'] as const) {
            old.input.level = old.selectedLevel = level;
            await save(old);
            assert.equal((await current(old.id)).input.level, level);
            assert.equal((await act(old.id, 'save-minutes', { minutes: '# 旧議事録 ' + level })).status, 'done');
        }
        // A saved legacy ledger wait can still be approved and completed.
        old.input.level = old.selectedLevel = '詳細';
        old.status = 'design'; old.phase = 'design'; old.stage = '設計図';
        old.revisionUsed = false;
        await save(old);
        await assert.rejects(() => act(old.id, 'save-minutes', { minutes: '旧台帳待ちには保存不可' }), /完了した議事録/);
        await act(old.id, 'approve');
        const complete = await waitFor(old.id, 'done');
        assert.equal(complete.reviewer, 'codex');
        const legacy = { ...complete, input: { ...complete.input, purpose: '会議まとめ' } } as unknown as RecordData;
        await save(legacy);
        assert.equal((await readRecord(legacy.id)).input.purpose, '会議まとめ');
        assert.ok((await list()).some(r => r.id === legacy.id));
    } finally { if (previous === undefined) delete process.env.NEO_BROWSER; else process.env.NEO_BROWSER = previous; }
});

test('議事録の配信でも親フォルダ・隣の依頼・junction経由の読み取りを拒否する', async () => {
    const previous = process.env.NEO_BROWSER;
    process.env.NEO_BROWSER = 'none';
    let link: string | undefined;
    const outside = path.join(requests, 'outside-' + crypto.randomUUID());
    try {
        const created = await create({ ...input, purpose: '議事録' }, []);
        const done = await waitFor(created.id, 'done');
        assert.equal(path.dirname(outside), requests);
        await fs.mkdir(outside);
        await fs.writeFile(path.join(outside, 'minutes.md'), '非公開の素材');
        await fs.writeFile(path.join(outside, 'minutes.pdf'), '%PDF-private');
        await fs.writeFile(path.join(outside, 'page.png'), 'private-image');
        for (const file of ['minutes.md', 'minutes.pdf']) {
            await assert.rejects(safeFile(done.id, ['..', path.basename(outside), file]));
            await assert.rejects(safeFile(done.id, [outside, file]));
        }
        const previewLink = path.join(requestDir(done.id), 'preview');
        await fs.symlink(outside, previewLink, process.platform === 'win32' ? 'junction' : 'dir');
        link = previewLink;
        await assert.rejects(safeFile(done.id, ['preview', 'page.png']), /リンク先/);
        assert.ok(await safeFile(done.id, ['minutes.md']));
    } finally {
        if (link) await fs.unlink(link);
        if (path.dirname(outside) === requests) await fs.rm(outside, { recursive: true, force: true });
        if (previous === undefined) delete process.env.NEO_BROWSER; else process.env.NEO_BROWSER = previous;
    }
});
