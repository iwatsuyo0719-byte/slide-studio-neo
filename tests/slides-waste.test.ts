import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptLike, bundledInstruction } from '../server/bundle';
import { spreadsheetInstruction } from '../server/runner';

const sheet = 'https://docs.google.com/spreadsheets/d/abc/edit?gid=1#gid=1\n\n北綾瀬店の年間推移が分かる資料。\n3枚で。';

test('スプレッドシートのURLだけの素材を打合せ記録と誤認しない（https: を話者と見ない）', () => {
    assert.equal(transcriptLike(sheet), false);
    assert.equal(transcriptLike('田中：来週までに見積もりを出します'), true);
    assert.equal(transcriptLike('週次会議の文字起こし https://example.com/a'), true);
});

test('GoogleスプレッドシートのURLがある時だけ、最短の取得手順と保存を指示する', () => {
    const design = spreadsheetInstruction(sheet, '設計図');
    assert.match(design, /download_raw_file/);
    assert.match(design, /source\.csv/);
    assert.match(design, /1回だけやり直し/);
    assert.match(spreadsheetInstruction(sheet, '本番'), /取り直しません/);
    assert.equal(spreadsheetInstruction('売上は100万円です', '設計図'), '');
});

test('rules は1回だけ読む指示が入る', () => {
    assert.match(bundledInstruction('rules-設計図.md', 'C:/p'), /読み終えた箇所は読み直しません/);
});

test('添付ありの素材（ツールが付ける「添付：」の行）を打合せ記録と誤認しない', () => {
    assert.equal(transcriptLike('売上の推移を3枚で\n\n添付：\n- attachments/data.xlsx'), false);
});

test('シート指定（gid）があればxlsxで指定シートを読み、取得できなければ止まる指示が入る', () => {
    const design = spreadsheetInstruction(sheet, '設計図');
    assert.match(design, /gid/);
    assert.match(design, /question\.json/);
    assert.doesNotMatch(design, /ALL_TOOLSを/);
});

test('設計図の記載範囲は設計図の rules にだけ入る', async () => {
    const { compactDesign } = await import('../server/bundle');
    assert.match(compactDesign, /計算式や検算の過程は書きません/);
});
