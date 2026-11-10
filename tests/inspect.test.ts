import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { commonChecks, inspectSlides } from '../server/inspect';
import { findBrowser } from '../server/pdf';

const palette = { id: '026', name: '浅瀬アクア', mood: '', group: '', colors: ['#F0FDFF', '#C1EFF1', '#74D3D8', '#32A5B1', '#225966'] };

test('機械検査（共通）：長いダッシュ・素材に無い数値・空欄・配色の範囲外を出す', () => {
    const c = commonChecks(['売上は1,240万円で26%増—前年は980万円', '担当：xx、期日［　］'], ['#225966', '#FF0000'], '売上1,240万円、前年980万円', '', palette);
    assert.equal(c['長いダッシュ'].status, '不合格');
    assert.equal(c['数値の出所'].status, '未判定');
    assert.match(c['数値の出所'].evidence, /26%/);
    assert.match(c['xx・空欄の残り'].evidence, /^2件/);
    assert.match(c['色'].evidence, /#FF0000/);
    const ok = commonChecks(['売上は1,240万円'], ['#225966', '#222222'], '売上1,240万円', '', palette);
    assert.equal(ok['長いダッシュ'].status, '合格');
    assert.equal(ok['数値の出所'].status, '合格');
});

test('機械検査（html）：寸法・見出し30字・文字18px・はみ出しを判定し、画像を作る（Chrome/Edgeが無ければ未判定で止まらない）', { timeout: 120000 }, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-inspect-test-'));
    try {
        await fs.writeFile(path.join(dir, 'material.md'), '件数は1,200件');
        await fs.writeFile(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><style>body{margin:0}section{width:1920px;height:1080px;position:relative;overflow:hidden}h1{font-size:48px;margin:0}p{font-size:20px}</style>
<section><h1>件数は1,200件に増えたため受付を見直す</h1><p>本文</p></section>
<section><h1>これは三十字を大きく超える長すぎる見出しなので機械検査では不合格になるはずです</h1><p style="font-size:14px">小さい文字</p><p style="position:absolute;left:1900px;top:10px;white-space:nowrap">はみ出し</p></section>`);
        const r = await inspectSlides(dir, { formats: ['html'] } as any, palette);
        if (!await findBrowser()) { assert.equal(r.checks['描画（html）'].status, '未判定'); return; }
        assert.equal(r.checks['寸法（html）'].status, '合格');
        assert.equal(r.checks['見出し（html）'].status, '不合格');
        assert.equal(r.checks['文字の大きさ（html）'].status, '不合格');
        assert.equal(r.checks['はみ出し（html）'].status, '不合格');
        assert.equal(r.rendered, 2);
        assert.match(await fs.readFile(path.join(dir, 'check-auto.md'), 'utf8'), /機械検査の結果/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
