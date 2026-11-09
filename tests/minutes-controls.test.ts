import './workspace';
import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { create, current, act, minutesProtocol } from '../server/runner';
import { requestDir } from '../server/store';
import { progress, type RecordData, type Input } from '../lib/domain';
import { fakeMinutes } from '../server/fake';

process.env.NEO_FAKE_AI = '1';
process.env.NEO_FAKE_DELAY_MS = '40';
process.env.NEO_BROWSER = process.execPath;
let printedPages = 2;
// Simulate printing only; page counting and the complete workflow remain real.
mock.method(childProcess, 'spawn', (_bin: string, args: string[]) => {
    const child = new EventEmitter();
    const file = args.find(arg => arg.startsWith('--print-to-pdf='))!.slice('--print-to-pdf='.length);
    void fs.writeFile(file, '%PDF-1.7\n/Type /Pages\n' + '/Type /Page\n'.repeat(printedPages)).then(() => child.emit('close', 0));
    return child as childProcess.ChildProcess;
});
syncBuiltinESMExports();
after(() => { mock.restoreAll(); syncBuiltinESMExports(); });
const input: Input = { title: '分量とレビュー', audience: '社内', purpose: '議事録', formats: ['html'], level: '詳細', palette: '026', brand: '', material: '週次会議', ai: { provider: 'claude', model: 'opus', depth: 'auto' } };
async function waitFor(id: string, predicate: (r: RecordData) => boolean) {
    for (let n = 0; n < 1500; n++) {
        const r = await current(id);
        if (r.status === 'error') assert.fail(r.error);
        if (predicate(r)) return r;
        await delay(5);
    }
    assert.fail('状態待ちがタイムアウト');
}
const done = (id: string) => waitFor(id, r => r.status === 'done');
const shortens = (r: RecordData) => r.logs.filter(l => l.includes('分量の自動短縮（1回）')).length;
async function start(purpose: Input['purpose'], markers: string) {
    const r = await create({ ...input, purpose, material: input.material + markers }, []);
    if (purpose !== '議事録') { await waitFor(r.id, r => r.status === 'design'); await act(r.id, 'approve'); }
    return r.id;
}
test('議事録protocol：本番・手直し・短縮は字数と保持事項、最新正本を指示する', () => {
    const r = { input } as RecordData;
    for (const stage of ['本番', '手直し'] as const) {
        const text = minutesProtocol(r, stage, '/request', '/prompts');
        assert.match(text, /約2,500字（A4 2〜3枚）/);
        assert.match(text, /決定事項・宿題・未確認事項は削らない/);
    }
    const text = minutesProtocol(r, '手直し', '/request', '/prompts', true);
    assert.match(text, /最新の minutes.md を元に/);
    assert.match(text, /論点と経緯を短くまとめ直/);
    assert.doesNotMatch(text, /review.md（あれば）と final-feedback.md（あれば）に従って/);
});
test('4枚：短縮1回でなお4枚でも完了し、短縮中のメーターは100%にならない', async () => {
    const id = await start('議事録', '[long]');
    const shortening = await waitFor(id, r => !!r.minutesShortened && r.status === 'running');
    assert.equal(shortening.stage, '手直し');
    assert.equal(shortening.phase, 'production');
    assert.ok(progress(shortening, Date.now() + 99999999, [100, 200]).percent < 100);
    const r = await done(id);
    assert.equal(r.pdfPages, 4);
    assert.equal(r.pdfNote, undefined);
    assert.equal(r.pdfPageNote, 'PDFは 4 枚です（目安2〜3枚）');
    assert.equal(shortens(r), 1);
    assert.ok(r.logs.some(l => l.includes(r.pdfPageNote!)));
    assert.ok(r.minutes!.length > 3500 && r.minutes!.length < 8000);
    for (const section of ['決定事項', '宿題', '次回の確認事項']) {
        const content = (s: string) => s.split('## ' + section + '\n')[1].split('\n## ')[0];
        assert.ok(r.minutes!.includes(content(fakeMinutes)));
    }
    assert.equal(progress(r, Date.now(), [100, 200]).percent, 100);
});
test('短縮で2枚に収まる／3枚では短縮しない／4枚という実カウントでも1回だけ', async () => {
    const reduced = await done(await start('議事録', '[long][shorten-ok]'));
    assert.equal(reduced.pdfPages, 2);
    assert.equal(shortens(reduced), 1);
    printedPages = 3;
    const three = await done(await start('議事録', ''));
    assert.equal(three.pdfPages, 3);
    assert.equal(shortens(three), 0);
    printedPages = 4;
    const four = await done(await start('議事録', ''));
    assert.equal(four.pdfPages, 4);
    assert.equal(shortens(four), 1);
    printedPages = 2;
});
test('完了後の手動保存・AI修正は最新の本文でPDF枚数だけを更新する', async () => {
    const id = await start('議事録', '');
    const first = await done(id);
    const markdown = first.minutes! + '\n手で残した記録。' + '長い経緯。'.repeat(1000);
    printedPages = 4;
    const saved = await act(id, 'save-minutes', { minutes: markdown });
    assert.equal(saved.minutes, markdown);
    assert.equal(saved.pdfPages, 4);
    assert.equal(shortens(saved), 0);
    assert.equal(saved.minutesShortened, undefined);
    await act(id, 'revise', { feedback: '決定事項を確認する' });
    const revised = await done(id);
    assert.ok(revised.minutes!.startsWith(markdown));
    assert.equal(revised.pdfPages, 4);
    assert.equal(shortens(revised), 0);
    printedPages = 2;
});
test('PDF不可時は枚数・古い注記を消して短縮せず保存する', async () => {
    const id = await start('議事録', '[long]');
    await done(id);
    process.env.NEO_BROWSER = 'none';
    try {
        const saved = await act(id, 'save-minutes', { minutes: '# PDFなしで保存' });
        assert.ok(saved.pdfNote);
        assert.equal(saved.pdfPages, undefined);
        assert.equal(saved.pdfPageNote, undefined);
        const noPDF = await done(await start('議事録', '[long]'));
        assert.equal(shortens(noPDF), 0);
        assert.equal(noPDF.pdfPages, undefined);
    } finally { process.env.NEO_BROWSER = process.execPath; }
});
test('議事録・スライド：Codex実行失敗でClaudeレビュー／両方失敗なら手直しせず完了', async () => {
    for (const purpose of ['議事録', '報告'] as const) {
        const fallback = await done(await start(purpose, '[review-error]'));
        assert.equal(fallback.reviewFallback, true);
        assert.equal(fallback.reviewer, 'claude');
        assert.match(fallback.review, /Codexレビュー未実施（Claude Codeで代替）/);
        assert.ok(fallback.timings['手直し']);
        const skipped = await done(await start(purpose, '[review-both-error]'));
        assert.equal(skipped.error, undefined);
        assert.equal(skipped.reviewer, undefined);
        assert.equal(skipped.reviewFallback, true);
        assert.equal(skipped.review, '');
        assert.match(skipped.reviewNote!, /レビューなしで手直しを省略/);
        assert.equal(skipped.timings['手直し'], undefined);
        assert.ok(!skipped.files.includes('review.md') && !skipped.files.includes('revision.md'));
        assert.ok(skipped.logs.some(l => l.includes(skipped.reviewNote!)));
    }
});
test('Codexレビュー中にユーザーが中断したらClaudeへ切り替えない', async () => {
    process.env.NEO_FAKE_DELAY_MS = '180';
    try {
        const id = await start('議事録', '[review-error]');
        await waitFor(id, r => r.stage === 'レビュー' && r.reviewer === 'codex');
        const stopped = await act(id, 'stop');
        assert.equal(stopped.status, 'stopped');
        assert.equal(stopped.reviewFallback, false);
        assert.ok(!stopped.logs.some(l => l.includes('Claude Codeで代替')));
    } finally { process.env.NEO_FAKE_DELAY_MS = '40'; }
});
