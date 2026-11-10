import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { bundleRules, prepareRules, section, typeNumbers, evidenceNumbers, bundledInstruction } from '../server/bundle';
import { minutesProtocol } from '../server/runner';
import { workspace, repo } from '../server/store';
import type { Input, Stage, RecordData } from '../lib/domain';

const input: Input = { title: '定例報告', audience: '社内', purpose: '報告', material: '売上は前年比120%。', formats: ['html'], level: '簡易', palette: '026', brand: '', ai: { provider: 'codex', model: 'gpt-6.1-sol', depth: 'auto' } };
async function fixture(t: import('node:test').TestContext) {
    const dir = await fs.mkdtemp(path.join(workspace, 'bundle-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.writeFile(path.join(dir, 'material.md'), input.material);
    await fs.writeFile(path.join(dir, 'request.md'), '定例報告。静止HTML。');
    await fs.writeFile(path.join(dir, 'design.md'), '型06 バブル優先度マップ、07 滝分解、E08 評価表');
    return { dir, get: async (stage: Stage, changes: Partial<Input> = {}) => fs.readFile(path.join(dir, await bundleRules({ root: repo, dir, input: { ...input, ...changes }, stage })), 'utf8') };
}
test('節：親は###を含み、未知・重複の見出しは失敗する', () => {
    const md = '# 冒頭\n説明\n## 親\n本文\n### 子\n点検\n## 次\n次本文';
    assert.equal(section(md), '# 冒頭\n説明');
    assert.match(section(md, '親'), /### 子\n点検/);
    assert.doesNotMatch(section(md, '親'), /次本文/);
    assert.throws(() => section(md, '未知'), /見出し/);
    assert.throws(() => section(md + '\n## 親', '親'), /重複/);
});
test('型番号・E番号は別々に抽出し重複、範囲外、日付、小数を除く', () => {
    assert.deepEqual(typeNumbers('型06・07、06、48、49、00、E08、2026-11-10、12.5、106'), ['06', '07', '48']);
    assert.deepEqual(evidenceNumbers('E01 E12 E01 E13 E001 AE03 E031'), ['E01', 'E12']);
});
test('設計図：設計節とevidence入口、会話とauto配色だけ条件追加', async t => {
    const f = await fixture(t), text = await f.get('設計図');
    for (const h of ['冒頭', '版と保存先', '依頼の受け取り', '主張を先に定める', '資料全体の筋道', '表現を選ぶ順序', '48型の用途と構図', '型が不要な単純図', '保存する設計と成果物']) assert.ok(text.includes('出典：core.md「' + h + '」'), h);
    assert.match(text, /出典：evidence.md/);
    assert.doesNotMatch(text, /出典：(?:meeting|interactive|icons).md|出典：evidence\/|出典：references|^- 静止HTML|^- pptxを要求|## 描画寸法と色/m);
    await fs.writeFile(path.join(f.dir, 'material.md'), '田中さん：進めましょう。');
    const auto = await f.get('設計図', { palette: 'auto' });
    assert.match(auto, /出典：meeting.md/);
    assert.match(auto, /出典：references\/palettes\/PALETTES_100.md/);
});
test('本番html：選択型の補足行、E08のみ。操作とアイコンは指定時だけ', async t => {
    const f = await fixture(t), text = await f.get('本番');
    for (const h of ['主張を先に定める', '図の共通文法', '描画寸法と色']) assert.ok(text.includes('## ' + h));
    assert.match(text, /- 06の塗りつぶし/); assert.match(text, /- 07では/);
    assert.match(text, /出典：evidence\/E08.md/); assert.match(text, /- 静止HTML/);
    assert.doesNotMatch(text, /出典：evidence\/E01.md|出典：evidence.md|出典：icons.md|出典：interactive.md|^- pptxを要求|^- 08 |## 依頼の受け取り|出典：references/m);
    await fs.writeFile(path.join(f.dir, 'request.md'), '操作可能なHTMLを求める');
    await fs.appendFile(path.join(f.dir, 'design.md'), '\n主体のアイコンを配置');
    const interactive = await f.get('本番');
    assert.match(interactive, /出典：interactive.md/); assert.match(interactive, /出典：icons.md/);
});
test('本番pptx：入れ子の規則と手本を保持しHTML規則を除く', async t => {
    const f = await fixture(t), text = await f.get('本番', { formats: ['pptx'] });
    assert.match(text, /- pptx/); assert.match(text, /  - 表示しない数値ラベル/);
    assert.match(text, /examples\/pptx_text_with_charts.pptx/);
    assert.match(text, /examples\/pptx_tables_charts.pptx/);
    assert.doesNotMatch(text, /- 静止HTML|出典：interactive.md/);
});
test('検査・レビュー・手直し：誠実さと出力節。レビューと手直しだけ型と詳細レビュー', async t => {
    const f = await fixture(t);
    for (const stage of ['検査', 'レビュー', '手直し'] as const) {
        const text = await f.get(stage, { formats: ['pptx'] });
        assert.match(text, /## 提出前の検査/); assert.match(text, /### 根拠の誠実さ/);
        assert.match(text, /## 描画寸法と色/); assert.match(text, /- pptx/);
        assert.doesNotMatch(text, /- 静止HTML|出典：evidence\/|## 図の共通文法/);
        assert.equal(text.includes('出典：README.md「詳細版のレビュー」'), stage !== '検査');
        assert.equal(text.includes('- 06の塗りつぶし'), stage !== '検査');
    }
});
test('議事録：全段階でmeeting・minutesとREADMEの議事録行だけ', async t => {
    const f = await fixture(t);
    for (const stage of ['設計図', '本番', '検査', 'レビュー', '手直し'] as const) {
        const text = await f.get(stage, { purpose: '議事録', palette: 'auto' });
        assert.match(text, /出典：meeting.md/); assert.match(text, /出典：minutes.md/);
        assert.match(text, /目的が議事録なら/);
        assert.doesNotMatch(text, /出典：core.md|出典：evidence|出典：icons|出典：interactive|出典：references|## 詳細版のレビュー/);
        const protocol = minutesProtocol({ input: { ...input, purpose: '議事録' } } as RecordData, stage, f.dir, '/prompts', false, 'rules-' + stage + '.md');
        assert.match(protocol, /制作規則はこれだけ/);
        assert.doesNotMatch(protocol, /README.md|\/prompts\/meeting.md|\/prompts\/minutes.md|core.md/);
    }
});
test('欠けた見出し・ファイル・書込失敗は1行ログで従来指示へ戻る', async t => {
    const f = await fixture(t), read = fs.readFile.bind(fs);
    const logs: string[] = [];
    const mocked = t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
        const result = await read(...args);
        return String(args[0]).endsWith('core.md') ? String(result).replace('## 描画寸法と色', '## 未知の見出し') : result;
    });
    assert.equal(await prepareRules({ root: repo, dir: f.dir, input, stage: '検査' }, async l => { logs.push(l); }), undefined);
    mocked.mock.restore();
    assert.equal(logs.length, 1); assert.match(logs[0], /README.*描画寸法と色/); assert.doesNotMatch(logs[0], /[\r\n]/);
    await fs.rm(path.join(f.dir, 'design.md'));
    assert.equal(await prepareRules({ root: repo, dir: f.dir, input, stage: '本番' }, async l => { logs.push(l); }), undefined);
    assert.equal(logs.length, 2);
    const write = t.mock.method(fs, 'rename', async () => { throw Object.assign(Error('write failed'), { code: 'EIO' }); });
    assert.equal(await prepareRules({ root: repo, dir: f.dir, input, stage: '検査' }, async l => { logs.push(l); }), undefined);
    write.mock.restore();
    assert.equal(logs.length, 3);
    assert.match(minutesProtocol({ input: { ...input, purpose: '議事録' } } as RecordData, '本番', f.dir, '/prompts'), /README.md/);
    assert.match(bundledInstruction('rules-検査.md', '/prompts'), /手本/);
});

test('rulesは成果物一覧にもダウンロード許可リストにも入らない', async () => {
    const { artifacts, requestDir, safeFile } = await import('../server/store');
    const id = '2026-11-10-bundle-artifacts', dir = requestDir(id);
    await fs.mkdir(dir, { recursive: true });
    try {
        await fs.writeFile(path.join(dir, 'rules-本番.md'), '内部規則');
        await fs.writeFile(path.join(dir, 'index.html'), '<html></html>');
        const r = { id, input, files: [] } as unknown as RecordData;
        await artifacts(r);
        assert.deepEqual(r.files, ['index.html']);
        await assert.rejects(safeFile(id, ['rules-本番.md']), /公開できません/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
