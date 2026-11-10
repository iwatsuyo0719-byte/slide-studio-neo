import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { historyInput, requestTitle, parsePalettes, requestText, purposes, subscriptionEnv, allowedDepths, allowedModels, effectiveAI, defaults, validateInput, validateSettings, estimate, historyKey, progress, type Input, type RecordData } from '../lib/domain';
import { cliArgs } from '../server/cli';
import { fakePptx } from '../server/fake';
const input: Input = { title: '試験', audience: '社外', purpose: '提案', formats: ['html'], level: '詳細', palette: '026', brand: '#225966', material: 'テスト素材', ai: { provider: 'codex', model: 'gpt-6.1-sol', depth: 'auto' } };
const palettes = parsePalettes(await fs.readFile('references/palettes/PALETTES_100.md', 'utf8'));
test('配色100組・4系統・既定026・5色を原本から読む', () => { assert.equal(palettes.length, 100); assert.equal(new Set(palettes.map(p => p.group)).size, 4); assert.equal(palettes.find(p => p.id === '026')!.name, '浅瀬アクア'); assert.deepEqual(palettes.find(p => p.id === '026')!.colors, ['#F0FDFF', '#C1EFF1', '#74D3D8', '#32A5B1', '#225966']); assert.ok(palettes.every(p => p.colors.length === 5)); assert.throws(() => parsePalettes('')); });
for (const purpose of Object.keys(purposes) as Input['purpose'][]) {
    test('依頼文：' + purpose + '・読み手・版・配色・5行+2行', () => { const text = requestText({ ...input, purpose }, palettes, ['試験.pdf']); assert.equal(text.trim().split('\n').length, 7); assert.match(text, /読み手：社外。敬体/); assert.ok(text.includes(purposes[purpose].structure)); assert.match(text, /版：詳細/); assert.match(text, purpose === '議事録' ? /使わない（議事録）/ : /026 浅瀬アクア/); assert.match(text, /試験.pdf/); });
}
test('おまかせ・ブランド・AUTOも依頼文へ渡す', () => { assert.match(requestText({ ...input, palette: 'auto', level: 'AUTO' }, palettes), /近い3組/); assert.match(requestText({ ...input, palette: 'brand' }, palettes), /#225966/); });

test('議事録：配色を無視・依頼文と形式に依存しない専用目安', () => {
    const i: Input = { ...input, title: '', purpose: '議事録', palette: 'brand', brand: 'invalid' };
    assert.equal(validateInput(i, defaults).brand, '');
    assert.doesNotThrow(() => validateInput({ ...i, brand: null, palette: null }, defaults));
    assert.throws(() => validateInput({ ...i, formats: ['pdf'] }, defaults));
    const text = requestText(i, palettes);
    assert.match(text, /素材から会議名を決めて議事録を作る/);
    assert.match(text, /出力：議事録 minutes.md（Markdown正本）。PDFはツールが作る/);
    assert.doesNotMatch(text, /invalid|近い3組|スライド/);
    assert.match(historyKey(i, '簡易'), /\|minutes$/);
    assert.notEqual(historyKey(i, '簡易'), historyKey(input, '簡易'));
    assert.equal(historyKey(i, '詳細'), historyKey({ ...i, formats: ['pptx', 'html'] }, '詳細'));
    for (const level of ['簡易', '詳細', 'AUTO', null, 'invalid']) {
        assert.equal(validateInput({ ...i, level }, defaults).level, '詳細');
        assert.deepEqual(estimate(i, level as Input['level'], 'design'), [5 * 60000, 10 * 60000]);
        assert.deepEqual(estimate(i, level as Input['level'], 'production'), [5 * 60000, 10 * 60000]);
        assert.match(requestText({ ...i, level } as Input, palettes), /版：詳細・止まらず完成まで（固定）/);
    }
    assert.deepEqual(estimate(i, '詳細', 'production'), [5 * 60000, 10 * 60000]);
    const key = historyKey(i, '詳細');
    assert.deepEqual(estimate(i, '詳細', 'design', [60, 120, 300].map(ms => ({ key, phase: 'design' as const, ms }))), [5 * 60000, 10 * 60000]);
    assert.deepEqual(estimate(i, '詳細', 'production', [60, 120, 300].map(ms => ({ key, phase: 'production' as const, ms }))), [5 * 60000, 10 * 60000]);
    for (const level of ['簡易', '詳細'] as const) {
        const stages = ['作る', 'レビュー', 'PDF'];
        let previous = -1;
        for (const stage of stages) {
            const r = { input: i, status: 'running', stage, phase: 'production', selectedLevel: level, stageStart: 100, phaseStart: 100, activeMs: 0 } as RecordData;
            const p = progress(r, 100, [100, 200]).percent;
            assert.ok(p > previous && p < 100); previous = p;
        }
    }
});
test('サブスク専用：環境変数4種を大小文字とも取り除く', () => { const env = subscriptionEnv({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'b', CODEX_API_KEY: 'c', ANTHROPIC_AUTH_TOKEN: 'd', openai_api_key: 'e', PATH: 'ok' }); assert.deepEqual(env, { PATH: 'ok' }); });
test('品質下限・自動深さ・レビューhigh以上', () => { assert.deepEqual(allowedModels(defaults, 'claude'), ['opus', 'fable']); assert.deepEqual(allowedModels(defaults, 'codex'), ['gpt-6.1-sol', 'gpt-5.6-sol']); assert.ok(!allowedDepths(defaults, 'codex', true).includes('medium')); assert.equal(effectiveAI(input.ai, '簡易').depth, 'medium'); assert.equal(effectiveAI(input.ai, '詳細').depth, 'high'); assert.equal(effectiveAI({ ...input.ai, depth: 'medium' }, '簡易', defaults, true).depth, 'high'); assert.throws(() => validateSettings({ ...defaults, reviewMinimum: 'medium' })); assert.throws(() => validateInput({ ...input, ai: { ...input.ai, model: 'small' } }, defaults)); assert.throws(() => validateInput({ ...input, palette: 'brand', brand: 'wrong' }, defaults)); });
test('実績3件から組み合わせ別の中央値を使う', () => { const key = historyKey(input, '詳細'); assert.deepEqual(estimate(input, '詳細', 'design'), [240000, 480000]); assert.deepEqual(estimate(input, '詳細', 'design', [{ key, phase: 'design', ms: 60000 }, { key, phase: 'design', ms: 120000 }]), [240000, 480000]); assert.deepEqual(estimate(input, '詳細', 'design', [60000, 120000, 300000].map(ms => ({ key, phase: 'design' as const, ms }))), [96000, 144000]); assert.notEqual(historyKey({ ...input, ai: { ...input.ai, depth: 'max' } }, '詳細'), key); assert.deepEqual(estimate({ ...input, formats: ['pptx', 'html'] }, '詳細', 'production'), [2400000, 3900000]); });
test('100%は完了だけ・超過・停止時は固定', () => { const r = { status: 'running', stage: '手直し', phase: 'production', selectedLevel: '詳細', stageStart: 0, phaseStart: 0, activeMs: 0 } as RecordData; assert.ok(progress(r, 99999999, [100, 200]).percent < 100); assert.equal(progress(r, 99999999, [100, 200]).overtime, true); assert.equal(progress({ ...r, status: 'done' }, 99999999, [100, 200]).percent, 100); assert.deepEqual(progress({ ...r, status: 'design' }, 1000, [100, 200]), progress({ ...r, status: 'design' }, 9000, [100, 200])); });
test('CLI引数：Codex read-only、stdin終了はexecuteでignore、Claude許可を限定', () => { const a = cliArgs(input.ai, '詳細', defaults, 'C:/req', 'test', true, 'C:/prompts'); assert.ok(a.includes('read-only')); assert.ok(a.includes('model_reasoning_effort=high')); const b = cliArgs({ provider: 'claude', model: 'opus', depth: 'auto' }, '詳細', defaults, 'C:/req', 'test', false, 'C:/prompts'); assert.ok(b.includes('Read(C:/prompts/**)')); assert.ok(!b.includes('--dangerously-skip-permissions')); });
test('偽pptxはOOXMLのzipを生成する', () => { const bytes = fakePptx(); assert.equal(bytes.readUInt32LE(0), 0x04034b50); assert.ok(bytes.includes(Buffer.from('ppt/slides/slide1.xml'))); assert.ok(bytes.includes(Buffer.from('SLIDE STUDIO NEO'))); });
test('AIが書いたBOM付きJSONも読める', async () => {
    const { jsonRead } = await import('../server/store');
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'neo-')), 'decision.json');
    await fs.writeFile(file, '\uFEFF{"level":"簡易"}');
    assert.deepEqual(await jsonRead(file, null), { level: '簡易' });
    await fs.writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"level":"詳細"}', 'utf16le')]));
    assert.deepEqual(await jsonRead(file, null), { level: '詳細' });
    await fs.rm(path.dirname(file), { recursive: true, force: true });
});


test('実測に基づく初期目安は両形式で一致する', () => {
    for (const format of ['pptx', 'html'] as const) {
        const i = { ...input, formats: [format] };
        assert.deepEqual(estimate(i, '簡易', 'production'), [20 * 60000, 35 * 60000]);
        assert.deepEqual(estimate(i, '詳細', 'design'), [4 * 60000, 8 * 60000]);
        assert.deepEqual(estimate(i, '詳細', 'production'), [35 * 60000, 60 * 60000]);
    }
});

test('検査開始時の進捗は本番16分・検査10分の比率を反映する', () => {
    const r = { status: 'running', stage: '検査', phase: 'production', selectedLevel: '簡易', stageStart: 100, phaseStart: 100, activeMs: 0 } as RecordData;
    assert.equal(progress(r, 100, [20 * 60000, 35 * 60000]).percent, 61);
    assert.equal(progress({ ...r, selectedLevel: '詳細' }, 100, [35 * 60000, 60 * 60000]).percent, 38);
});

test('議事録のCLIはスライド生成用のBash許可を渡さず、レビューは新規Codex read-only', () => {
    const creator = cliArgs({ provider: 'claude', model: 'opus', depth: 'auto' }, '詳細', defaults, 'C:/req', '議事録', false, 'C:/prompts', true);
    assert.ok(creator.includes('Read,Write,Edit'));
    assert.doesNotMatch(creator.join(' '), /Bash|build_slides|pptx|preview/);
    const reviewer = cliArgs({ provider: 'codex', model: 'gpt-6.1-sol', depth: 'auto' }, '詳細', defaults, 'C:/req', '独立レビュー', true, 'C:/prompts', true);
    assert.equal(reviewer[0], 'exec');
    assert.ok(reviewer.includes('read-only'));
    assert.ok(!reviewer.includes('resume'));
});

test('履歴入力：旧会議まとめと未知の目的を議事録にし、履歴原本は変更しない', () => {
    for (const purpose of ['会議まとめ', 'unknown', 'toString']) {
        const legacy = { ...input, purpose } as Input;
        assert.equal(historyInput(legacy).purpose, '議事録');
        assert.equal(legacy.purpose, purpose);
    }
    for (const purpose of Object.keys(purposes) as Input['purpose'][]) assert.equal(historyInput({ ...input, purpose }).purpose, purpose);
});
test('題名：先頭の空行・括弧行・記号行を飛ばし、本文がなければ既定名にする', () => {
    const material = '\n （文字起こし・未整形。架空の会議です）\n(注意)\n【注意】\n[注記]\n---\n！？★\n週次会議の記録\n本文';
    assert.equal(requestTitle({ ...input, title: '', purpose: '議事録', material }), '週次会議の記録');
    assert.equal(requestTitle({ ...input, title: '指定名', material }), '指定名');
    for (const purpose of ['議事録', '提案'] as const) {
        assert.equal(requestTitle({ ...input, title: '', purpose, material: '\n（注記）\n***' }), purpose === '議事録' ? '議事録' : 'スライド');
    }
    assert.equal(requestTitle({ ...input, title: '', purpose: '議事録', material: '' }, [{ name: 'transcript.txt' }]), '議事録');
    assert.equal(requestTitle({ ...input, title: '', material: '' }, [{ name: 'slides.txt' }]), 'slides-txt');
    assert.equal(requestTitle({ ...input, title: '', material: '（注意）本題' }), '（注意）本題');
});
