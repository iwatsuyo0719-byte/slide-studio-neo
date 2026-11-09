import test, { after, mock } from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMinutesPDF, findBrowser, minutesHTML, PDF_NOTE, PDF_CONVERSION_NOTE } from '../server/pdf';
import { fakeMinutes } from '../server/fake';

// Inspect only this process's temporary files, even when another test prints concurrently.
const systemTemporary = path.resolve(os.tmpdir());
const suiteTemporary = await fs.mkdtemp(path.join(systemTemporary, 'neo-pdf-suite-'));
mock.method(os, 'tmpdir', () => suiteTemporary);
after(async () => {
    mock.restoreAll(); syncBuiltinESMExports();
    assert.equal(path.dirname(suiteTemporary), systemTemporary);
    await fs.rm(suiteTemporary, { recursive: true, force: true });
});

// Restricted Windows test accounts cannot start Chrome's renderer sandbox.
// This opt-in changes only the test process; production PDF launch arguments stay intact.
if (process.env.NEO_TEST_NO_SANDBOX === '1') {
    const spawn = childProcess.spawn;
    mock.method(childProcess, 'spawn', (bin: string, args: string[], options: childProcess.SpawnOptions) => spawn(bin, args.includes('--headless=new') ? [...args, '--no-sandbox'] : args, options));
    syncBuiltinESMExports();
    after(() => { mock.restoreAll(); syncBuiltinESMExports(); });
}

test('PDF：指定の印刷書式とHTMLエスケープ', () => {
    const html = minutesHTML('# 会議\n\n<script>実行</script>');
    for (const value of ['size: A4 portrait; margin: 25mm 20mm', 'font-size: 16pt', 'font-size: 13pt', 'font-size: 10.5pt; line-height: 1.6', 'font-size: 10pt', 'font-size: 9pt', '"Yu Gothic", "YuGothic", "游ゴシック", "Hiragino Sans", "Noto Sans JP", sans-serif']) assert.ok(html.includes(value));
    assert.doesNotMatch(html, /<script>/);
});
test('PDF：Chrome/Edgeで実際に印刷し、一時HTMLは依頼に残さない', { timeout: 90000 }, async t => {
    if (!await findBrowser()) return t.skip('Chrome/Edgeが見つかりません');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-pdf-test-'));
    const before = (await fs.readdir(os.tmpdir())).filter(n => n.startsWith('neo-minutes-'));
    try {
        await fs.writeFile(path.join(dir, 'minutes.md'), fakeMinutes);
        assert.equal(await createMinutesPDF(dir), undefined);
        assert.equal((await fs.readFile(path.join(dir, 'minutes.pdf'))).subarray(0, 4).toString(), '%PDF');
        assert.deepEqual((await fs.readdir(dir)).sort(), ['minutes.md', 'minutes.pdf']);
        assert.deepEqual((await fs.readdir(os.tmpdir())).filter(n => n.startsWith('neo-minutes-')).sort(), before.sort());
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('PDF：none・失敗・中断時は古いPDFを渡さない', async () => {
    const previous = process.env.NEO_BROWSER;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-pdf-test-'));
    const before = (await fs.readdir(os.tmpdir())).filter(n => n.startsWith('neo-minutes-')).sort();
    try {
        await fs.writeFile(path.join(dir, 'minutes.md'), fakeMinutes);
        await fs.writeFile(path.join(dir, 'minutes.pdf'), 'old');
        process.env.NEO_BROWSER = 'none';
        assert.equal(await findBrowser(), null);
        assert.equal(await createMinutesPDF(dir), PDF_NOTE);
        await assert.rejects(fs.stat(path.join(dir, 'minutes.pdf')));
        process.env.NEO_BROWSER = path.join(dir, 'missing-browser');
        assert.equal(await createMinutesPDF(dir), PDF_CONVERSION_NOTE);
        const controller = new AbortController(); controller.abort();
        await assert.rejects(createMinutesPDF(dir, controller.signal));
        assert.deepEqual(await fs.readdir(dir), ['minutes.md']);
        assert.deepEqual((await fs.readdir(os.tmpdir())).filter(n => n.startsWith('neo-minutes-')).sort(), before);
    } finally {
        if (previous === undefined) delete process.env.NEO_BROWSER; else process.env.NEO_BROWSER = previous;
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test('PDF：印刷中の中断でも一時HTML・プロファイルと途中のPDFを残さない', { timeout: 15000 }, async t => {
    if (!await findBrowser()) return t.skip('Chrome/Edgeが見つかりません');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-pdf-test-'));
    const before = (await fs.readdir(os.tmpdir())).filter(n => n.startsWith('neo-minutes-')).sort();
    try {
        await fs.writeFile(path.join(dir, 'minutes.md'), fakeMinutes);
        const controller = new AbortController();
        await assert.rejects(createMinutesPDF(dir, controller.signal, child => {
            child.once('spawn', () => controller.abort());
        }));
        assert.deepEqual(await fs.readdir(dir), ['minutes.md']);
        assert.deepEqual((await fs.readdir(os.tmpdir())).filter(n => n.startsWith('neo-minutes-')).sort(), before);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
