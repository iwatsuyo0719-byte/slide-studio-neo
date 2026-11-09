import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { locate, terminate, type Command } from './cli';
import { markdownToHTML } from '../lib/markdown';

export const PDF_NOTE = 'PDFは作れませんでした（Chrome か Edge が必要）';
export const PDF_CONVERSION_NOTE = 'PDFは作れませんでした（議事録のPDF変換に失敗しました）';
export const printCSS = `
@page { size: A4 portrait; margin: 25mm 20mm;
    @bottom-center { content: counter(page); font-size: 9pt; }
}
body { font-family: "Yu Gothic", "YuGothic", "游ゴシック", "Hiragino Sans", "Noto Sans JP", sans-serif; font-size: 10.5pt; line-height: 1.6; color: #111; }
h1 { font-size: 16pt; font-weight: bold; }
h2, h3 { font-size: 13pt; font-weight: bold; break-after: avoid; }
p, li { font-size: 10.5pt; line-height: 1.6; }
table { width: 100%; border-collapse: collapse; font-size: 10pt; }
th, td { border: 1px solid #aaa; padding: 4pt 6pt; overflow-wrap: anywhere; }
th { background: #f2f2f2; }
tr { break-inside: avoid; }
thead { display: table-header-group; }
.unconfirmed, .note, small { font-size: 9pt; }
blockquote { margin-left: 1em; border-left: 2px solid #aaa; padding-left: 1em; }
body { overflow-wrap: anywhere; }
`;
export function minutesHTML(markdown: string) {
    return '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>議事録</title><style>' + printCSS + '</style></head><body>' + markdownToHTML(markdown) + '</body></html>';
}
export async function findBrowser(): Promise<Command | null> {
    if (process.env.NEO_BROWSER === 'none') return null;
    if (process.env.NEO_BROWSER) return { bin: process.env.NEO_BROWSER, prefix: [] };
    const candidates = process.platform === 'win32'
        ? ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].flatMap(relative => [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter((root): root is string => !!root).map(root => path.join(root, relative)))
        : process.platform === 'darwin'
            ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
            : ['/usr/bin/google-chrome', '/opt/google/chrome/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/opt/microsoft/msedge/msedge'];
    for (const bin of candidates) if (await fs.stat(bin).then(s => s.isFile()).catch(() => false)) return { bin, prefix: [] };
    for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'chrome', 'msedge']) {
        const command = await locate(name);
        if (command) return command;
    }
    return null;
}
// Wait for the process to close on timeout/abort before deleting its temporary profile.
async function print(browser: Command, args: string[], cwd: string, signal?: AbortSignal, onChild?: (child: ChildProcess) => void) {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
        const child = spawn(browser.bin, [...browser.prefix, ...args], { cwd, windowsHide: true, stdio: 'ignore' });
        onChild?.(child);
        let timedOut = false;
        const abort = () => { void terminate(child); };
        const timer = setTimeout(() => { timedOut = true; abort(); }, 60000);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
        child.on('error', error => { cleanup(); reject(error); });
        child.on('close', code => {
            cleanup();
            if (signal?.aborted || timedOut || code !== 0) reject(Error(signal?.aborted ? '中断しました' : 'PDF印刷に失敗しました'));
            else resolve();
        });
    });
}
export async function createMinutesPDF(dir: string, signal?: AbortSignal, onChild?: (child: ChildProcess) => void): Promise<string | undefined> {
    signal?.throwIfAborted();
    const output = path.resolve(dir, 'minutes.pdf');
    let temporary: string | undefined;
    try {
        // A previous PDF must never be offered for a newly revised Markdown document.
        await fs.rm(output, { force: true });
        const browser = await findBrowser();
        if (!browser) return PDF_NOTE;
        const markdown = await fs.readFile(path.join(dir, 'minutes.md'), 'utf8');
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-minutes-'));
        const html = path.join(temporary, 'minutes.html');
        await fs.writeFile(html, minutesHTML(markdown));
        await print(browser, ['--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--no-pdf-header-footer', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--user-data-dir=' + path.join(temporary, 'profile'), '--print-to-pdf=' + output, pathToFileURL(html).href], temporary, signal, onChild);
        const bytes = await fs.readFile(output);
        if (bytes.subarray(0, 4).toString() !== '%PDF') throw Error('PDFがありません');
        signal?.throwIfAborted();
    } catch (error) {
        await fs.rm(output, { force: true }).catch(cleanupError => console.warn('PDFの後片付けに失敗しました', cleanupError));
        if (signal?.aborted) throw error;
        console.warn('議事録のPDF変換に失敗しました', error);
        return PDF_CONVERSION_NOTE;
    } finally {
        if (temporary) try {
            const target = path.resolve(temporary);
            if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('neo-minutes-')) throw Error('一時フォルダの場所が不正です');
            await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch (error) {
            console.warn('PDF一時フォルダの後片付けに失敗しました', error);
        }
    }
}
