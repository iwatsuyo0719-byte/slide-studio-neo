import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkMinutes, checkMinutesFiles } from '../server/minutes-check';
import { fakeMinutes } from '../server/fake';
import { workspace } from '../server/store';

const ledger = '| 引用 |\n|---|\n| 「計画を確認します」 |';
const source = '計画を確認します。会議は2026年11月10日、12.5万円。';

test('機械検査：構成の順、前方一致、宿題の表は該当の節だけを確認', () => {
    assert.equal(checkMinutes(fakeMinutes, ledger, source).checks.構成.status, '合格');
    assert.equal(checkMinutes(fakeMinutes.replace('## 宿題', '## 宿題（担当別）'), ledger, source).checks.構成.status, '合格');
    assert.equal(checkMinutes(fakeMinutes.replace('## 決定事項', '## 仮').replace('## 宿題', '## 決定事項').replace('## 仮', '## 宿題'), ledger, source).checks.構成.status, '不合格');
    for (const bad of [fakeMinutes.replace('担当 | 内容 | 期限', '担当 | 内容 | 日付'), fakeMinutes.replace('|---|---|---|', ''), fakeMinutes.replace('## 宿題', '## タスク')]) {
        assert.equal(checkMinutes(bad, ledger, source).checks['宿題の表'].status, '不合格');
    }
});

test('機械検査：両ファイルの引用を空白・改行を無視して素材・添付と照合', () => {
    const ok = checkMinutes(fakeMinutes, ledger, '計画を\n 確認します');
    assert.equal(ok.checks.引用.status, '合格');
    const bad = checkMinutes(fakeMinutes, ledger + '\n| 「未発言」 |', '');
    assert.equal(bad.checks.引用.status, '不合格');
    assert.deepEqual(bad.unmatchedQuotes, ['minutes.md：「計画を確認します」', 'ledger.md：「計画を確認します」', 'ledger.md：「未発言」']);
    assert.equal(checkMinutes(fakeMinutes, ledger, '', [source]).checks.引用.status, '合格');
    assert.equal(checkMinutes(fakeMinutes, ledger, '', [], ['scan.pdf']).checks.引用.status, '未判定');
});

test('機械検査：数値の出所は数値単位で列挙し、不合格にしない', () => {
    const result = checkMinutes(fakeMinutes + '\n12.5万円、99人、2件、99件。', ledger, source);
    assert.deepEqual(result.numbersToConfirm, ['99', '2']);
    assert.equal(result.checks['数値の出所'].status, '未判定');
    assert.equal(checkMinutes('１２．５万円', '', '12.5万円').numbersToConfirm.length, 0);
});

test('機械検査：字数・xx・未確認の数と末尾、台帳は報告のみ', () => {
    const result = checkMinutes(fakeMinutes, ledger, source.repeat(10));
    assert.equal(result.xxCount, 1);
    assert.equal(result.unconfirmedCount, 5);
    assert.equal(result.hasUnconfirmedTail, true);
    assert.equal(result.ledgerTableOnly, true);
    assert.equal(result.ledgerShorter, true);
    assert.equal(result.checks.台帳.status, '未判定');
    assert.equal(checkMinutes('あ'.repeat(1700), '', '').characterCount, 1700);
    assert.equal(checkMinutes('あ'.repeat(2501), '', '').checks.分量.status, '不合格');
    assert.equal(checkMinutes(fakeMinutes.replace('未確認事項', '確認点'), ledger, source).checks['未確認表示'].status, '不合格');
});

test('機械検査：JSON・Markdownに根拠を保存、読めない添付を明示', async () => {
    const dir = path.join(workspace, 'check-files');
    await fs.mkdir(path.join(dir, 'attachments'), { recursive: true });
    await fs.writeFile(path.join(dir, 'minutes.md'), fakeMinutes);
    await fs.writeFile(path.join(dir, 'ledger.md'), ledger);
    await fs.writeFile(path.join(dir, 'material.md'), '会議');
    await fs.writeFile(path.join(dir, 'attachments', 'source.txt'), source);
    await fs.writeFile(path.join(dir, 'attachments', 'scan.pdf'), '%PDF');
    assert.deepEqual(await checkMinutesFiles(dir), []);
    const json = JSON.parse(await fs.readFile(path.join(dir, 'check-auto.json'), 'utf8'));
    assert.equal(json.checks.引用.status, '合格');
    assert.match(await fs.readFile(path.join(dir, 'check-auto.md'), 'utf8'), /scan.pdf/);
});
