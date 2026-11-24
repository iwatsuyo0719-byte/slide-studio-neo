import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { defaults, validateInput, historyInput, historyKey, requestText, type Input } from '../lib/domain';
import { bundleRules } from '../server/bundle';
import { fitHtmlFile, FIT_MARKER } from '../server/fit';
import { fakeMotionHTML } from '../server/fake';
import { inspectSlides } from '../server/inspect';
import { findBrowser } from '../server/pdf';
import { create, current, act } from '../server/runner';
import { repo, workspace, requestDir } from '../server/store';

const input: Input = { title: '動く版の確認', audience: '社内', purpose: '報告', formats: ['html'], level: '簡易', palette: '026', brand: '', material: 'クリックで操作可能な動くHTML', ai: { provider: 'codex', model: 'gpt-6.1-sol', depth: 'auto' } };
async function fixture(t: import('node:test').TestContext) {
    const dir = await fs.mkdtemp(path.join(workspace, 'motion-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.writeFile(path.join(dir, 'material.md'), input.material);
    await fs.writeFile(path.join(dir, 'request.md'), requestText(input, []));
    await fs.writeFile(path.join(dir, 'design.md'), '型06・E01');
    return dir;
}

test('motion：省略と旧履歴は静止、boolean以外を拒否し、html無しはfalseに保存する', () => {
    for (const motion of [undefined, false, true]) {
        assert.equal(validateInput({ ...input, motion }, defaults).motion, motion === true);
        assert.equal(historyInput({ ...input, motion }).motion, motion === true);
    }
    for (const motion of [null, 0, 1, '', 'false', 'true', {}, []]) {
        assert.throws(() => validateInput({ ...input, motion }, defaults), /boolean/);
        assert.throws(() => validateInput({ ...input, formats: ['pptx'], motion }, defaults), /boolean/);
    }
    assert.equal(validateInput({ ...input, formats: ['pptx'], motion: true }, defaults).motion, false);
    assert.equal(validateInput({ ...input, purpose: '議事録', motion: true }, defaults).motion, false);
    assert.equal(historyKey(input, '簡易'), historyKey({ ...input, motion: false }, '簡易'));
    assert.notEqual(historyKey(input, '簡易'), historyKey({ ...input, motion: true }, '簡易'));
    assert.equal(historyKey({ ...input, formats: ['pptx'] }, '簡易'), historyKey({ ...input, formats: ['pptx'], motion: true }, '簡易'));
});

test('依頼文：htmlだけに静止版／動く版を添える（pptx併用と旧履歴）', () => {
    assert.match(requestText(input, []), /^出力：html（静止版）$/m);
    for (const motion of [false, true]) {
        const text = requestText({ ...input, motion, formats: ['pptx', 'html'] }, []);
        assert.ok(text.includes('出力：pptx ＋ html（' + (motion ? '動く版' : '静止版') + '）'));
    }
    assert.match(requestText({ ...input, formats: ['pptx'], motion: true }, []), /^出力：pptx$/m);
});

test('bundle：明示選択を全段階へ渡し、静止の本文語句では動く版にしない', async t => {
    const dir = await fixture(t);
    for (const stage of ['設計図', '本番', '検査', 'レビュー', '手直し'] as const) {
        for (const motion of [undefined, false, true]) {
            const name = await bundleRules({ root: repo, dir, input: { ...input, motion, formats: ['html', 'pptx'] }, stage });
            const rules = await fs.readFile(path.join(dir, name), 'utf8');
            assert.equal(rules.includes('出典：interactive.md'), motion === true);
            assert.equal(rules.includes('- 静止HTML'), motion !== true);
            assert.match(rules, /- pptx/);
            if (motion) assert.match(rules, /出力と動作検査/);
        }
    }
    const name = await bundleRules({ root: repo, dir, input: { ...input, motion: true, level: '詳細' }, stage: '設計図' });
    assert.match(await fs.readFile(path.join(dir, name), 'utf8'), /出典：interactive.md/);
    const ppt = await bundleRules({ root: repo, dir, input: { ...input, motion: true, formats: ['pptx'] }, stage: '本番' });
    assert.doesNotMatch(await fs.readFile(path.join(dir, ppt), 'utf8'), /出典：interactive.md/);
});

test('fit：動く版は自前の拡大縮小を保持し、ツールのfitを挿入しない', async t => {
    const dir = await fixture(t);
    await fs.writeFile(path.join(dir, 'index.html'), fakeMotionHTML);
    await fitHtmlFile(dir, true);
    assert.equal(await fs.readFile(path.join(dir, 'index.html'), 'utf8'), fakeMotionHTML);
    await fitHtmlFile(dir, false);
    assert.ok((await fs.readFile(path.join(dir, 'index.html'), 'utf8')).includes(FIT_MARKER));
});

test('機械検査：hiddenの2ページを#staticで画像化し、一覧を除外する', { timeout: 120000 }, async t => {
    const dir = await fixture(t);
    const html = fakeMotionHTML.replace('</script>', ';if(location.hash!=="#static")document.querySelectorAll("h1").forEach(h=>h.textContent="長".repeat(80));</script>')
        .replace('</div><script>', '<section id="overview" hidden><h1>一覧</h1></section></div><script>');
    await fs.writeFile(path.join(dir, 'index.html'), html);
    const result = await inspectSlides(dir, { ...input, motion: true }, undefined);
    assert.equal(result.checks['画面に合わせる処理（html）'].status, '未判定');
    assert.match(result.checks['画面に合わせる処理（html）'].evidence, /対象外/);
    if (!await findBrowser()) { assert.equal(result.checks['描画（html）'].status, '未判定'); return; }
    assert.equal(result.rendered, 2);
    for (const name of ['寸法（html）', '見出し（html）', '文字の大きさ（html）', 'はみ出し（html）']) assert.equal(result.checks[name]?.status, '合格', name + JSON.stringify(result));
    const a = await fs.readFile(path.join(dir, 'preview/page-01.png'));
    const b = await fs.readFile(path.join(dir, 'preview/page-02.png'));
    assert.notDeepEqual(a, b, 'ページを切り替えた画像であること');
});

test('機械検査：動く版のページを特定できなくても不合格にしない', async t => {
    const dir = await fixture(t);
    await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><h1>本文</h1>');
    const result = await inspectSlides(dir, { ...input, motion: true }, undefined);
    assert.deepEqual(result.failed, []);
    assert.equal(result.checks['描画（html）'].status, '未判定');
});

async function waitFor(id: string, status: string) {
    for (let n = 0; n < 1000; n++) {
        const r = await current(id);
        if (r.status === status) return r;
        if (r.status === 'error') assert.fail(r.error);
        await delay(10);
    }
    assert.fail('状態待ちタイムアウト：' + status);
}
test('偽AI：簡易と詳細の動く版が完了し、手直し後もfitを挿入しない', async () => {
    process.env.NEO_FAKE_AI = '1';
    process.env.NEO_FAKE_DELAY_MS = '10';
    for (const level of ['簡易', '詳細'] as const) {
        const created = await create({ ...input, motion: true, level }, []);
        if (level === '詳細') { await waitFor(created.id, 'design'); await act(created.id, 'approve'); }
        const done = await waitFor(created.id, 'done');
        assert.equal(done.input.motion, true);
        assert.ok(done.files.includes('index.html'));
        assert.match(await fs.readFile(path.join(requestDir(done.id), 'index.html'), 'utf8'), /fitCanvas/);
        await act(done.id, 'revise', { feedback: '見出しを確認' });
        await waitFor(done.id, 'done');
        assert.doesNotMatch(await fs.readFile(path.join(requestDir(done.id), 'index.html'), 'utf8'), /neo-slide-fit/);
    }
});

test('機械検査：既存の動く版見本は3ページだけを画像化し、誤って不合格にしない', { timeout: 120000 }, async t => {
    const dir = await fixture(t);
    const html = (await fs.readFile(path.join(repo, 'prompts/interactive_example.html'), 'utf8')).replace(/<link[^>]*>/gi, '');
    await fs.writeFile(path.join(dir, 'index.html'), html);
    const result = await inspectSlides(dir, { ...input, motion: true }, undefined);
    if (!await findBrowser()) { t.skip('Chrome/Edgeが見つかりません'); return; }
    assert.equal(result.rendered, 3, JSON.stringify(result));
    assert.deepEqual(result.failed, [], JSON.stringify(result));
});
