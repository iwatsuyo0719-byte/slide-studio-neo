import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { create, current, act } from '../server/runner';
import { requestDir } from '../server/store';
import type { RecordData } from '../lib/domain';

process.env.NEO_FAKE_AI = '1';
process.env.NEO_FAKE_DELAY_MS = '1';
process.env.NEO_BROWSER = process.execPath;
const input = { title: '短縮の復旧', audience: '社内', purpose: '議事録', formats: ['html'], level: '詳細', palette: '', brand: '', material: '[long] [review-error]', ai: { provider: 'codex', model: 'gpt-6.1-sol', depth: 'auto' } };
async function done(id: string) {
    for (let n = 0; n < 1000; n++) {
        const r = await current(id);
        if (r.status === 'error' || r.status === 'stopped') assert.fail(r.error);
        if (r.status === 'done') return r;
        await delay(5);
    }
    assert.fail('完了待ちタイムアウト');
}

for (const mode of ['shorten-failure', 'shorten-abort', 'pdf-failure', 'pdf-abort', 'success']) {
    test('自動短縮：' + mode + 'でも通常手直しの実測を作らず、失敗時は元の本文とPDFで完了', async t => {
        const writeFile = fs.writeFile;
        let originalMinutes = '', originalPDF = Buffer.alloc(0), prints = 0;
        let stop: Promise<RecordData> | undefined;
        let id = '';
        t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
            const file = String(args[0]), text = String(args[1]);
            if (file.endsWith('minutes.md') && text.includes('議論の経緯を記録する。')) {
                if (!originalMinutes) originalMinutes = text;
                else if (mode.startsWith('shorten-')) {
                    await writeFile(file, '短縮途中で壊れた本文');
                    if (mode === 'shorten-abort') stop = act(id, 'stop');
                    throw Error('短縮中の失敗');
                }
            }
            return writeFile(...args);
        });
        t.mock.method(childProcess, 'spawn', (_bin: string, args: string[]) => {
            const child = new EventEmitter() as childProcess.ChildProcess;
            const file = args.find(a => a.startsWith('--print-to-pdf='))!.slice('--print-to-pdf='.length);
            prints++;
            void (async () => {
                if (prints === 2 && mode.startsWith('pdf-')) {
                    await writeFile(file, '不完全なPDF');
                    if (mode === 'pdf-abort') stop = act(id, 'stop');
                    child.emit('close', 1);
                } else {
                    const bytes = Buffer.from('%PDF-test ' + prints + ' /Type /Page '.repeat(4));
                    if (prints === 1) originalPDF = bytes;
                    await writeFile(file, bytes);
                    child.emit('close', 0);
                }
            })().catch(e => child.emit('error', e));
            return child;
        });
        t.mock.method(console, 'warn', () => {});
        syncBuiltinESMExports();
        try {
            id = (await create(input, [])).id;
            const completed = await done(id);
            if (stop) assert.equal((await stop).status, 'done');
            assert.equal(completed.timings['手直し'], undefined);
            assert.equal(completed.minutesShortened, true);
            assert.equal(completed.pdfNote, undefined);
            assert.equal(completed.pdfPages, 4);
            assert.equal(completed.pdfPageNote, 'PDFは 4 枚です（目安2枚以下・多くて3枚）');
            assert.ok(completed.files.includes('minutes.pdf'));
            assert.equal(completed.reviewNote, undefined);
            const dir = requestDir(id);
            if (mode !== 'success') {
                assert.equal(completed.minutes, originalMinutes);
                assert.equal(await fs.readFile(path.join(dir, 'minutes.md'), 'utf8'), originalMinutes);
                assert.deepEqual(await fs.readFile(path.join(dir, 'minutes.pdf')), originalPDF);
                assert.ok(completed.logs.some(line => line.includes('短縮前の議事録とPDFを保持')));
            } else assert.notEqual(completed.minutes, originalMinutes);
            assert.equal(prints, mode.startsWith('shorten-') ? 1 : 2);
            if (mode.endsWith('abort')) {
                await assert.rejects(act(id, 'resume'), /停止している依頼だけ/);
                assert.equal((await current(id)).timings['手直し'], undefined);
                assert.ok(!(await fs.readdir(dir)).includes('review.md'));
            }
        } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    });
}

test('レビュー失敗の後のrevise：議事録とスライドの省略注記を引き継がない', async t => {
    process.env.NEO_BROWSER = 'none';
    try {
        for (const purpose of ['議事録', '提案']) {
            const created = await create({ ...input, purpose, level: purpose === '提案' ? '詳細' : input.level, palette: '026', material: '[review-error]' }, []);
            if (purpose === '提案') {
                for (let n = 0; n < 1000 && (await current(created.id)).status !== 'design'; n++) await delay(5);
                await act(created.id, 'approve');
            }
            const first = await done(created.id);
            if (purpose === '提案') assert.match(first.reviewNote!, /レビューなしで完了/);
            else assert.equal(first.reviewNote, undefined);
            await act(created.id, 'revise', { feedback: '見出しを短く' });
            const revised = await done(created.id);
            assert.equal(revised.reviewNote, undefined);
            assert.ok(revised.timings[purpose === '議事録' ? '作る' : '手直し']);
        }
    } finally { process.env.NEO_BROWSER = process.execPath; }
});
