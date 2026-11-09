import './workspace';
import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { create, act, current } from '../server/runner';
import { requestDir } from '../server/store';
import { findBrowser } from '../server/pdf';

// Same opt-in as pdf.test.ts; production PDF arguments are unchanged.
if (process.env.NEO_TEST_NO_SANDBOX === '1') {
    const spawn = childProcess.spawn;
    mock.method(childProcess, 'spawn', (bin: string, args: string[], options: childProcess.SpawnOptions) => spawn(bin, args.includes('--headless=new') ? [...args, '--no-sandbox'] : args, options));
    syncBuiltinESMExports();
    after(() => { mock.restoreAll(); syncBuiltinESMExports(); });
}
process.env.NEO_FAKE_AI = '1';
process.env.NEO_FAKE_DELAY_MS = '10';

test('workflow：save-minutesで正本と実PDFを更新し、PDF失敗時も保存を完了する', { timeout: 30000 }, async t => {
    if (!await findBrowser()) return t.skip('Chrome/Edgeが見つかりません');
    const created = await create({ title: 'PDF再作成', audience: '社内', purpose: '議事録', formats: ['html'], level: 'AUTO', palette: '', brand: '', material: '架空会議', ai: { provider: 'codex', model: 'gpt-6.1-sol', depth: 'auto' } }, []);
    let done;
    for (let n = 0; n < 1000; n++) {
        const r = await current(created.id);
        assert.notEqual(r.status, 'design');
        if (r.status === 'error') assert.fail(r.error);
        if (r.status === 'done') { done = r; break; }
        await delay(10);
    }
    assert.ok(done);
    assert.equal(done.pdfNote, undefined);
    const file = path.join(requestDir(created.id), 'minutes.pdf');
    const first = await fs.readFile(file);
    assert.equal(first.subarray(0, 4).toString(), '%PDF');
    const markdown = '# 手動で編集した新しい会議記録\n\nPDFを作り直したことを確認する本文。';
    const saved = await act(created.id, 'save-minutes', { minutes: markdown });
    assert.equal(saved.minutes, markdown);
    assert.equal(saved.pdfNote, undefined);
    assert.ok(saved.files.includes('minutes.pdf'));
    assert.equal(await fs.readFile(path.join(requestDir(created.id), 'minutes.md'), 'utf8'), markdown);
    const second = await fs.readFile(file);
    assert.equal(second.subarray(0, 4).toString(), '%PDF');
    assert.notDeepEqual(first, second);
    // A missing executable is a conversion failure, distinct from NEO_BROWSER=none.
    const previous = process.env.NEO_BROWSER;
    try {
        process.env.NEO_BROWSER = path.join(requestDir(created.id), 'missing-browser');
        const failedPDF = await act(created.id, 'save-minutes', { minutes: markdown + '\n保存だけでも完了する。' });
        assert.equal(failedPDF.status, 'done');
        assert.match(failedPDF.minutes!, /保存だけでも完了/);
        assert.ok(failedPDF.pdfNote);
        assert.ok(!failedPDF.files.includes('minutes.pdf'));
        await assert.rejects(fs.stat(file));
    } finally { if (previous === undefined) delete process.env.NEO_BROWSER; else process.env.NEO_BROWSER = previous; }
});
