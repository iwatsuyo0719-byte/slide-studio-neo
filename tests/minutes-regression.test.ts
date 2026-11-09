import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { create, current, act } from '../server/runner';
import { atomicText, requestDir, workspace } from '../server/store';
import { createMinutesPDF, PDF_CONVERSION_NOTE } from '../server/pdf';
import { POST } from '../app/api/neo/route';
import { token } from '../server/http';
import type { Input } from '../lib/domain';

const input: Input = { title: '', audience: '社内', purpose: '議事録', formats: ['html'], level: 'AUTO', palette: '', brand: '', material: '（未整形）\n---\n週次会議', ai: { provider: 'codex', model: 'gpt-6.1-sol', depth: 'auto' } };

test('JSON：4MB超は本文を解析せず413、上限以下は通常の検証へ進む', async () => {
    for (const size of [4 * 1024 * 1024, 4 * 1024 * 1024 + 1]) {
        const req = new Request('http://127.0.0.1/api/neo', { method: 'POST', headers: { host: '127.0.0.1', 'x-neo-token': token, 'content-type': 'application/json', 'content-length': String(size) }, body: '{invalid' });
        const response = await POST(req);
        assert.equal(response.status, size > 4 * 1024 * 1024 ? 413 : 400);
        assert.equal(req.bodyUsed, size <= 4 * 1024 * 1024);
    }
});

test('Markdown保存：renameで置換しハードリンク先を変更せず、rename失敗時は正本を保つ', async t => {
    await fs.mkdir(workspace, { recursive: true });
    const dir = await fs.mkdtemp(path.join(workspace, 'atomic-'));
    const file = path.join(dir, 'minutes.md'), linked = path.join(dir, 'linked.md');
    try {
        await fs.writeFile(file, '元の本文');
        await fs.link(file, linked);
        await atomicText(file, '新しい本文');
        assert.equal(await fs.readFile(linked, 'utf8'), '元の本文');
        assert.equal(await fs.readFile(file, 'utf8'), '新しい本文');
        const rename = t.mock.method(fs, 'rename', async () => { throw Object.assign(Error('rename failed'), { code: 'EIO' }); });
        await assert.rejects(atomicText(file, '壊れてはいけない'), /rename failed/);
        rename.mock.restore();
        assert.equal(await fs.readFile(file, 'utf8'), '新しい本文');
        assert.deepEqual((await fs.readdir(dir)).sort(), ['linked.md', 'minutes.md']);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('PDF：rm失敗でも全段階はdone、手動保存は成功、PDFの処理失敗は注記になる', async t => {
    process.env.NEO_FAKE_AI = '1'; process.env.NEO_FAKE_DELAY_MS = '1';
    const previous = process.env.NEO_BROWSER;
    process.env.NEO_BROWSER = process.execPath;
    const leftovers: string[] = [];
    const originalRM = fs.rm;
    let failOutput = false;
    const warnings = t.mock.method(console, 'warn', () => {});
    const rm = t.mock.method(fs, 'rm', async (file: Parameters<typeof fs.rm>[0], options: Parameters<typeof fs.rm>[1]) => {
        const target = String(file);
        if (path.basename(target).startsWith('neo-minutes-')) {
            leftovers.push(target);
            throw Object.assign(Error('profile busy'), { code: 'EBUSY' });
        }
        if (failOutput && target.endsWith('minutes.pdf')) throw Object.assign(Error('pdf busy'), { code: 'EBUSY' });
        return originalRM(file, options);
    });
    t.mock.method(childProcess, 'spawn', (_bin: string, args: string[]) => {
        const child = new EventEmitter();
        const file = args.find(arg => arg.startsWith('--print-to-pdf='))!.slice('--print-to-pdf='.length);
        void fs.writeFile(file, '%PDF-test').then(() => child.emit('close', 0));
        return child as childProcess.ChildProcess;
    });
    syncBuiltinESMExports();
    try {
        const created = await create(input, []);
        assert.match(created.id, /-週次会議-/);
        let done;
        for (let n = 0; n < 500; n++) {
            const r = await current(created.id);
            if (r.status === 'error') assert.fail(r.error);
            if (r.status === 'done') { done = r; break; }
            await delay(10);
        }
        assert.ok(done);
        assert.equal(done.pdfNote, undefined);
        assert.ok(done.timings['手直し']);
        const file = path.join(requestDir(created.id), 'minutes.md');
        const linked = path.join(requestDir(created.id), 'linked.md');
        const before = await fs.readFile(file, 'utf8');
        await fs.link(file, linked);
        const saved = await act(created.id, 'save-minutes', { minutes: '# 保存した議事録' });
        assert.equal(saved.status, 'done');
        assert.equal(saved.minutes, '# 保存した議事録');
        assert.equal(saved.pdfNote, undefined);
        assert.equal(await fs.readFile(linked, 'utf8'), before);
        failOutput = true;
        assert.equal(await createMinutesPDF(requestDir(created.id)), PDF_CONVERSION_NOTE);
        const savedWithoutPDF = await act(created.id, 'save-minutes', { minutes: '# PDFが失敗しても保存' });
        assert.equal(savedWithoutPDF.status, 'done');
        assert.equal(savedWithoutPDF.minutes, '# PDFが失敗しても保存');
        assert.equal(savedWithoutPDF.pdfNote, PDF_CONVERSION_NOTE);
        assert.ok(!savedWithoutPDF.files.includes('minutes.pdf'));
        assert.ok(warnings.mock.callCount() >= 4);
    } finally {
        rm.mock.restore();
        t.mock.restoreAll(); syncBuiltinESMExports();
        if (previous === undefined) delete process.env.NEO_BROWSER; else process.env.NEO_BROWSER = previous;
        for (const folder of new Set(leftovers)) {
            assert.ok(path.basename(folder).startsWith('neo-minutes-'));
            assert.equal(path.dirname(folder), path.resolve((await import('node:os')).tmpdir()));
            await originalRM(folder, { recursive: true, force: true });
        }
    }
});

test('PDF：MarkdownのHTML変換例外はブラウザ不足と区別した注記を返す', async t => {
    const dir = await fs.mkdtemp(path.join(workspace, 'conversion-'));
    const previous = process.env.NEO_BROWSER;
    process.env.NEO_BROWSER = process.execPath;
    const readFile = fs.readFile;
    const mockRead = t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
        if (String(args[0]) === path.join(dir, 'minutes.md')) return { replace() { throw new RangeError('conversion failed'); } } as unknown as string;
        return readFile(...args);
    });
    t.mock.method(console, 'warn', () => {});
    try { assert.equal(await createMinutesPDF(dir), PDF_CONVERSION_NOTE); }
    finally {
        mockRead.mock.restore();
        if (previous === undefined) delete process.env.NEO_BROWSER; else process.env.NEO_BROWSER = previous;
        await fs.rm(dir, { recursive: true, force: true });
    }
});
