// P1：スライドの描画と、測れば決まる検査をツールが行う（AIの検査は判断が要る項目だけにする）。
// 生成を止めないことを優先し、描画や検査ができない時は「未判定」として記録して続ける。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { findBrowser } from './pdf';
import { locate, execute, terminate } from './cli';
import { atomicText } from './store';
import type { Input, Palette } from '../lib/domain';

export type Status = '合格' | '不合格' | '未判定';
export type Check = { status: Status; evidence: string };
export type InspectResult = { checks: Record<string, Check>; rendered: number; failed: string[] };

const ALLOWED_TEXT = ['#222222', '#6B7C85', '#D9DEE3', '#FFFFFF', '#000000'];
const LONG_DASH = /[—―]/;
const numbersIn = (s: string) => [...new Set(s.normalize('NFKC').match(/\d+(?:[,，]\d{3})*(?:\.\d+)?%?/g) || [])].filter(n => n.replace(/[^\d]/g, '').length >= 2);
const hex = (c: string) => c.toUpperCase();

// 色・数値・ダッシュ・空欄は、出力形式に関係なく本文の文字と色の一覧から判定する。
export function commonChecks(texts: string[], colors: string[], material: string, design: string, palette?: Palette): Record<string, Check> {
    const all = texts.join('\n');
    const checks: Record<string, Check> = {};
    checks['長いダッシュ'] = LONG_DASH.test(all) ? { status: '不合格', evidence: '— または ― を含む文字があります' } : { status: '合格', evidence: 'なし' };
    const source = (material + '\n' + design).normalize('NFKC').replace(/[,，]/g, '');
    const unknown = numbersIn(all).filter(n => !source.includes(n.replace(/[,，]/g, '')));
    checks['数値の出所'] = { status: unknown.length ? '未判定' : '合格', evidence: '素材にも設計図にも無い数値（確認が要る）：' + (unknown.join('、') || 'なし') };
    const blanks = (all.match(/xx/gi) || []).length + (all.match(/［\s*］/g) || []).length;
    checks['xx・空欄の残り'] = { status: '合格', evidence: blanks + '件（報告のみ）' };
    if (palette) {
        const allowed = new Set([...palette.colors.map(hex), ...ALLOWED_TEXT, '#D97706']);
        const outside = [...new Set(colors.map(hex))].filter(c => !allowed.has(c));
        checks['色'] = { status: '合格', evidence: outside.length ? '配色の範囲外の色（確認が要る・不合格にはしない）：' + outside.join('、') : '配色5色と規定の文字色の範囲内' };
    } else checks['色'] = { status: '未判定', evidence: '配色が固定されていない（おまかせ・ブランド色）' };
    return checks;
}

function toMarkdown(result: InspectResult, note: string) {
    const rows = Object.entries(result.checks).map(([k, v]) => `| ${k} | ${v.status} | ${v.evidence.replace(/\n/g, '<br>').replace(/\|/g, '｜')} |`);
    return ['# 機械検査の結果（ツールが自動で作成）', '', note, '', '| 項目 | 判定 | 根拠 |', '|---|---|---|', ...rows, '', `画像：preview/page-01.png〜（${result.rendered}枚）`, ''].join('\n');
}

// ---- HTML：Chrome/Edge を DevTools で操作し、測定と画像化を1回の起動で行う
async function withBrowser<T>(fn: (send: (m: string, p?: unknown) => Promise<any>) => Promise<T>, signal?: AbortSignal, onChild?: (c: ChildProcess) => void): Promise<T> {
    signal?.throwIfAborted();
    const browser = await findBrowser();
    if (!browser) throw Error('Chrome か Edge が見つかりません');
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-inspect-'));
    const child = spawn(browser.bin, [...browser.prefix, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    onChild?.(child);
    const abort = () => { void terminate(child); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        const port = await new Promise<string>((resolve, reject) => {
            let err = '';
            const timer = setTimeout(() => reject(Error('ブラウザの起動が時間切れです')), 30000);
            child.stderr!.on('data', d => { err += d; const m = err.match(/ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) { clearTimeout(timer); resolve(m[1]); } });
            child.on('close', () => { clearTimeout(timer); reject(Error('ブラウザが終了しました')); });
        });
        const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as { type: string; webSocketDebuggerUrl: string }[];
        const page = targets.find(t => t.type === 'page');
        if (!page) throw Error('ブラウザのページが見つかりません');
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
        let id = 0;
        const pending = new Map<number, (m: any) => void>();
        ws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); } };
        // ブラウザが落ちた・止めた時は、待っている問い合わせをすぐ失敗させる（30秒待たない）
        ws.onclose = () => { for (const [, done] of pending) done({ error: { message: 'ブラウザとの接続が切れました' } }); pending.clear(); };
        const send = (method: string, params: unknown = {}) => new Promise<any>((resolve, reject) => {
            const n = ++id;
            const timer = setTimeout(() => { pending.delete(n); reject(Error('ブラウザの応答が時間切れです：' + method)); }, 30000);
            pending.set(n, m => { clearTimeout(timer); m.error ? reject(Error(m.error.message)) : resolve(m.result); });
            ws.send(JSON.stringify({ id: n, method, params }));
        });
        try { return await fn(send); } finally { ws.close(); }
    } finally {
        signal?.removeEventListener('abort', abort);
        await terminate(child);
        for (let n = 0; n < 10; n++) {
            try { await fs.rm(profile, { recursive: true, force: true }); break; } catch { await new Promise(r => setTimeout(r, 300)); }
        }
    }
}

// ページ内で実行する測定（文字列として渡す）
const HTML_PROBE = `(() => {
  const toHex = c => { const m = c.match(/\\d+(\\.\\d+)?/g); if (!m || (m.length > 3 && +m[3] === 0)) return null; return '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join(''); };
  const sections = [...document.querySelectorAll('section')];
  const pages = sections.map(s => {
    const r = s.getBoundingClientRect();
    const head = s.querySelector('h1, h2, [data-claim]');
    let minFont = Infinity, overflow = 0; const texts = []; const colors = new Set();
    const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode; const v = t.textContent.trim(); if (!v) continue;
      const el = t.parentElement; const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      texts.push(v); minFont = Math.min(minFont, parseFloat(cs.fontSize));
      const c = toHex(el instanceof SVGElement ? (cs.fill || cs.color) : cs.color); if (c) colors.add(c);
      const range = document.createRange(); range.selectNodeContents(t); const b = range.getBoundingClientRect();
      if (b.width && (b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1)) overflow++;
    }
    s.querySelectorAll('*').forEach(el => { const cs = getComputedStyle(el); for (const p of ['backgroundColor', 'fill', 'stroke']) { const c = cs[p] && cs[p] !== 'none' ? toHex(cs[p]) : null; if (c) colors.add(c); } });
    // h1/h2 が無い（SVGで描いた）ページは、32px以上で一番大きい文字を見出しとみなす
    let big = null, bigSize = 31;
    s.querySelectorAll('text, div, p, span').forEach(el => { const v = el.textContent.trim(); if (!v || el.children.length) return; const f = parseFloat(getComputedStyle(el).fontSize); if (f > bigSize) { bigSize = f; big = v; } });
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, heading: head ? head.textContent.trim() : big, headingLines: head ? Math.round(head.getBoundingClientRect().height / parseFloat(getComputedStyle(head).lineHeight || '0') || 0) : 0, minFont: minFont === Infinity ? null : minFont, overflow, texts, colors: [...colors] };
  });
  return JSON.stringify(pages);
})()`;

async function inspectHTML(dir: string, signal?: AbortSignal, onChild?: (c: ChildProcess) => void) {
    return withBrowser(async send => {
        await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
        await send('Page.enable');
        await send('Page.navigate', { url: pathToFileURL(path.join(dir, 'index.html')).href });
        for (let n = 0; n < 60; n++) {
            const ready = await send('Runtime.evaluate', { expression: 'document.readyState === "complete" && (!document.fonts || document.fonts.status === "loaded")', returnByValue: true });
            if (ready.result.value) break;
            await new Promise(r => setTimeout(r, 250));
        }
        const pages = JSON.parse((await send('Runtime.evaluate', { expression: HTML_PROBE, returnByValue: true })).result.value) as { x: number; y: number; w: number; h: number; heading: string | null; headingLines: number; minFont: number | null; overflow: number; texts: string[]; colors: string[] }[];
        const preview = path.join(dir, 'preview');
        await fs.mkdir(preview, { recursive: true });
        for (const [i, p] of pages.entries()) {
            const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: p.x, y: p.y, width: Math.max(1, p.w), height: Math.max(1, p.h), scale: 1 } });
            await fs.writeFile(path.join(preview, `page-${String(i + 1).padStart(2, '0')}.png`), Buffer.from(shot.data, 'base64'));
        }
        return pages;
    }, signal, onChild);
}

// ---- pptx：python-pptx で構造を測り、Windows では PowerPoint で画像化する
const PPTX_PROBE = String.raw`
import json, sys
from pptx import Presentation
from pptx.util import Emu
p = Presentation(sys.argv[1])
W, H = p.slide_width, p.slide_height
def runs_of(shape):
    frames = []
    if shape.has_text_frame: frames.append(shape.text_frame)
    if getattr(shape, 'has_table', False) and shape.has_table:
        for row in shape.table.rows:
            for c in row.cells: frames.append(c.text_frame)
    for tf in frames:
        for para in tf.paragraphs:
            for r in para.runs: yield r
def walk(shapes):
    for s in shapes:
        yield s
        if s.shape_type == 6: yield from walk(s.shapes)
out = {'width_pt': W / 12700, 'height_pt': H / 12700, 'slides': []}
for s in p.slides:
    info = {'min_pt': None, 'outside': 0, 'texts': [], 'colors': [], 'title': None, 'title_pt': 0, 'chart_issues': []}
    for sh in walk(s.shapes):
        try:
            if sh.left is not None and (sh.left < -12700 or sh.top < -12700 or sh.left + sh.width > W + 12700 or sh.top + sh.height > H + 12700): info['outside'] += 1
        except Exception: pass
        for r in runs_of(sh):
            if not r.text.strip(): continue
            info['texts'].append(r.text)
            if r.font.size is not None:
                pt = r.font.size.pt
                info['min_pt'] = pt if info['min_pt'] is None else min(info['min_pt'], pt)
                if sh.has_text_frame and pt > info['title_pt'] and pt >= 20:
                    info['title_pt'] = pt; info['title'] = sh.text_frame.text.strip()
            try:
                if r.font.color and r.font.color.type is not None and r.font.color.rgb is not None: info['colors'].append('#' + str(r.font.color.rgb))
            except Exception: pass
        try:
            if sh.fill.type == 1 and sh.fill.fore_color.rgb is not None: info['colors'].append('#' + str(sh.fill.fore_color.rgb))
        except Exception: pass
        if getattr(sh, 'has_chart', False) and sh.has_chart:
            xml = sh.chart._chartSpace.xml
            if 'val="stacked"' in xml or 'val="percentStacked"' in xml:
                if 'dLblPos val="outEnd"' in xml: info['chart_issues'].append('積み上げに outEnd')
            import re
            for lbl in re.findall(r'<c:dLbl>(.*?)</c:dLbl>', xml, re.S):
                if '<c:delete val="1"/>' in lbl:
                    if '<c:show' in lbl: info['chart_issues'].append('消すラベルに表示の指定')
                elif '<c:showSerName' not in lbl or '<c:showCatName' not in lbl: info['chart_issues'].append('個別ラベルの表示指定が不足')
    out['slides'].append(info)
print(json.dumps(out))
`;
// 失敗しても必ず閉じる。利用者が開いているPowerPointには触らない（呼ぶ前に起動中か確かめ、起動中なら画像化しない）
const PPT_EXPORT = `On Error Resume Next
Set app = CreateObject("PowerPoint.Application")
If Err.Number <> 0 Then WScript.Quit 2
Set pres = app.Presentations.Open(WScript.Arguments(0), True, False, False)
If Err.Number <> 0 Then
  app.Quit
  WScript.Quit 3
End If
For i = 1 To pres.Slides.Count
  pres.Slides(i).Export WScript.Arguments(1) & "\\page-" & Right("0" & i, 2) & ".png", "PNG", 1920, 1080
Next
failed = Err.Number
pres.Close
app.Quit
If failed <> 0 Then WScript.Quit 4
`;
const powerPointRunning = () => new Promise<boolean>(resolve => execFile('tasklist', ['/FI', 'IMAGENAME eq POWERPNT.EXE', '/NH'], { windowsHide: true }, (error, out) => resolve(!error && /POWERPNT\.EXE/i.test(String(out)))));
const killPowerPoint = () => new Promise<void>(resolve => execFile('taskkill', ['/IM', 'POWERPNT.EXE', '/F'], { windowsHide: true }, () => resolve()));

async function inspectPPTX(dir: string, render: boolean, signal?: AbortSignal, onChild?: (c: ChildProcess) => void) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-pptx-'));
    try {
        const script = path.join(tmp, 'probe.py');
        await fs.writeFile(script, PPTX_PROBE);
        const python = await locate('python') || await locate('python3');
        let probe: any = null;
        if (python) {
            const out = await execute(python, [script, path.join(dir, 'slides.pptx')], dir, undefined, onChild, signal, 60000).catch(() => { signal?.throwIfAborted(); return ''; });
            try { probe = JSON.parse(out.trim().split('\n').pop() || ''); } catch { probe = null; }
        }
        const preview = path.join(dir, 'preview');
        await fs.mkdir(preview, { recursive: true });
        let rendered = false, note = '';
        signal?.throwIfAborted();
        if (render && process.platform === 'win32') {
            if (await powerPointRunning()) note = 'PowerPointが起動中のため画像化しませんでした（利用中の画面に触らないため）';
            else {
                const vbs = path.join(tmp, 'export.vbs');
                await fs.writeFile(vbs, PPT_EXPORT);
                try {
                    rendered = await execute({ bin: 'cscript', prefix: [] }, ['//nologo', vbs, path.join(dir, 'slides.pptx'), preview], dir, undefined, onChild, signal, 120000).then(() => true, () => false);
                } finally {
                    // 時間切れ・中断・失敗で、このツールが起動した PowerPoint が残っていれば閉じる（起動前は動いていなかったことを確認済み）
                    if (await powerPointRunning()) await killPowerPoint();
                }
                signal?.throwIfAborted();
            }
        }
        return { probe, rendered, note };
    } finally { await fs.rm(tmp, { recursive: true, force: true }).catch(() => { }); }
}

export async function inspectSlides(dir: string, input: Input, palette: Palette | undefined, signal?: AbortSignal, onChild?: (c: ChildProcess) => void): Promise<InspectResult> {
    const checks: Record<string, Check> = {};
    const material = await fs.readFile(path.join(dir, 'material.md'), 'utf8').catch(() => '');
    const design = await fs.readFile(path.join(dir, 'design.md'), 'utf8').catch(() => '');
    const texts: string[] = [], colors: string[] = [];
    const notes: string[] = [];
    const preview = path.join(dir, 'preview');
    // 画像はツールが作り直すので、以前の画像（AIが作ったものを含む）は消す
    for (const old of await fs.readdir(preview).catch(() => [] as string[])) if (/\.(png|jpe?g|pdf)$/i.test(old)) await fs.rm(path.join(preview, old), { force: true });
    if (input.formats.includes('html') && await fs.stat(path.join(dir, 'index.html')).catch(() => null)) {
        try {
            const pages = await inspectHTML(dir, signal, onChild);
            const bad = pages.filter(p => Math.round(p.w) !== 1920 || Math.round(p.h) !== 1080);
            checks['寸法（html）'] = { status: pages.length && !bad.length ? '合格' : '不合格', evidence: `section ${pages.length}枚` + (bad.length ? '、1920×1080でないページ：' + bad.map(p => pages.indexOf(p) + 1).join('、') : '') };
            const longHead = pages.map((p, i) => ({ i: i + 1, h: p.heading })).filter(p => p.h && [...p.h.replace(/\s/g, '')].length > 30);
            checks['見出し（html）'] = pages.some(p => p.heading) ? { status: longHead.length ? '不合格' : '合格', evidence: longHead.length ? '30字を超える見出し：' + longHead.map(p => `P${p.i}「${p.h}」`).join('、') : '全見出し30字以内' } : { status: '未判定', evidence: '見出しの要素を特定できません' };
            const small = pages.map((p, i) => ({ i: i + 1, f: p.minFont })).filter(p => p.f !== null && p.f < 18);
            checks['文字の大きさ（html）'] = { status: small.length ? '不合格' : '合格', evidence: small.length ? '18px未満の文字：' + small.map(p => `P${p.i} ${p.f}px`).join('、') : '全ページ18px以上' };
            const over = pages.map((p, i) => ({ i: i + 1, n: p.overflow })).filter(p => p.n);
            checks['はみ出し（html）'] = { status: over.length ? '不合格' : '合格', evidence: over.length ? 'ページの外に出た文字：' + over.map(p => `P${p.i} ${p.n}か所`).join('、') : 'なし' };
            pages.forEach(p => { texts.push(...p.texts); colors.push(...p.colors); });
        } catch (error) {
            signal?.throwIfAborted();
            checks['描画（html）'] = { status: '未判定', evidence: '画像化・測定ができませんでした：' + String(error) };
        }
    }
    let rendered = (await fs.readdir(preview).catch(() => [] as string[])).filter(f => /^page-\d+\.png$/.test(f)).length;
    if (input.formats.includes('pptx') && await fs.stat(path.join(dir, 'slides.pptx')).catch(() => null)) {
        if (input.formats.includes('html')) notes.push('html と pptx の両方がある時、画像は html を優先し、pptx は構造だけ測る');
        // html と pptx の両方がある時は、画像は html のものを使い、PowerPointでは画像化しない（上書きしない）
        const { probe, rendered: pptRendered, note } = await inspectPPTX(dir, !input.formats.includes('html'), signal, onChild).catch(error => { signal?.throwIfAborted(); return { probe: null, rendered: false, note: String(error) }; });
        if (probe) {
            const sizeOk = Math.round(probe.width_pt) === 960 && Math.round(probe.height_pt) === 540;
            checks['寸法（pptx）'] = { status: sizeOk ? '合格' : '不合格', evidence: `${Math.round(probe.width_pt)}×${Math.round(probe.height_pt)}pt、${probe.slides.length}枚` };
            const longHead = probe.slides.map((s: any, i: number) => ({ i: i + 1, h: s.title })).filter((s: any) => s.h && [...s.h.replace(/\s/g, '')].length > 30);
            checks['見出し（pptx）'] = probe.slides.some((s: any) => s.title) ? { status: longHead.length ? '不合格' : '合格', evidence: longHead.length ? '30字を超える見出し：' + longHead.map((s: any) => `P${s.i}「${s.h}」`).join('、') : '全見出し30字以内' } : { status: '未判定', evidence: '見出しの文字枠を特定できません' };
            const small = probe.slides.map((s: any, i: number) => ({ i: i + 1, p: s.min_pt })).filter((s: any) => s.p !== null && s.p < 12);
            checks['文字の大きさ（pptx）'] = { status: small.length ? '不合格' : '合格', evidence: small.length ? '12pt未満の文字：' + small.map((s: any) => `P${s.i} ${s.p}pt`).join('、') : '全ページ12pt以上（グラフ内の文字は対象外）' };
            const out = probe.slides.map((s: any, i: number) => ({ i: i + 1, n: s.outside })).filter((s: any) => s.n);
            checks['はみ出し（pptx）'] = { status: out.length ? '不合格' : '合格', evidence: out.length ? 'スライドの外に出た図形：' + out.map((s: any) => `P${s.i} ${s.n}個`).join('、') : 'なし' };
            const chart = probe.slides.flatMap((s: any, i: number) => s.chart_issues.map((c: string) => `P${i + 1} ${c}`));
            checks['グラフの設定（pptx）'] = { status: chart.length ? '不合格' : '合格', evidence: chart.length ? [...new Set(chart)].join('、') : '問題なし' };
            probe.slides.forEach((s: any) => { texts.push(...s.texts); colors.push(...s.colors); });
        } else checks['構造（pptx）'] = { status: '未判定', evidence: 'python と python-pptx で読めませんでした' };
        if (!input.formats.includes('html')) {
            rendered = (await fs.readdir(preview).catch(() => [] as string[])).filter(f => /^page-\d+\.png$/.test(f)).length;
            checks['描画（pptx）'] = pptRendered && rendered ? { status: '合格', evidence: `PowerPointで開いて${rendered}枚を画像化` } : { status: '未判定', evidence: note || 'PowerPointで画像化できませんでした（PowerPointが無い・開けない）' };
        }
    }
    Object.assign(checks, commonChecks(texts, colors, material, design, palette));
    const failed = Object.entries(checks).filter(([, v]) => v.status === '不合格').map(([k]) => k);
    const result: InspectResult = { checks, rendered, failed };
    await atomicText(path.join(dir, 'check-auto.json'), JSON.stringify(result, null, 2));
    await atomicText(path.join(dir, 'check-auto.md'), toMarkdown(result, notes.join('\n')));
    return result;
}
