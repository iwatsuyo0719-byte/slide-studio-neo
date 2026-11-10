import fs from 'node:fs/promises';
import path from 'node:path';
import { isMinutes, type Input, type Stage } from '../lib/domain';
import { atomicText } from './store';

// A parent section includes its ### children. Never silently omit missing rules.
export function section(md: string, heading?: string) {
    const headings = [...md.matchAll(/^(#{2,3}) (.+)\r?$/gm)];
    if (!heading) {
        const intro = md.slice(0, headings[0]?.index).trim();
        if (!intro.startsWith('# ')) throw Error('冒頭の見出しがありません');
        return intro;
    }
    const found = headings.filter(h => h[2] === heading);
    if (found.length !== 1) throw Error('見出しが見つからないか重複しています：' + heading);
    const start = found[0];
    const end = headings.find(h => h.index! > start.index! && h[1].length <= start[1].length)?.index;
    return md.slice(start.index, end).trim();
}
export function typeNumbers(design: string) {
    return [...new Set([...design.matchAll(/(?<![\w.\-/])(?:0[1-9]|[1-3]\d|4[0-8])(?![\w.\-/])/g)].map(m => m[0]))];
}
export function evidenceNumbers(design: string) {
    return [...new Set([...design.matchAll(/(?<![A-Za-z0-9])E(?:0[1-9]|1[0-2])(?![A-Za-z0-9])/g)].map(m => m[0]))];
}
export function transcriptLike(material: string) {
    return /文字起こし|議事|会議|打合せ|打ち合わせ|発言|話者|さん|氏[：:]|[「」]|^\s*[^\n：:]{1,30}[：:]|\d{1,2}:\d{2}/m.test(material);
}
function outputRules(saved: string, formats: Input['formats']) {
    const bullets = saved.match(/^- .*(?:\n(?!- ).*)*/gm) || [];
    if (!bullets.some(b => b.startsWith('- 静止HTML')) || !bullets.some(b => b.startsWith('- pptx'))) throw Error('出力形式の箇条がありません');
    return '## 保存する設計と成果物\n\n' + bullets.filter(b =>
        formats.includes('html') && b.startsWith('- 静止HTML') ||
        formats.includes('pptx') && /^- (?:pptx|本文と表・グラフを同じページに置くときの手本)/.test(b)
    ).join('\n');
}
export type BundleOptions = { root: string; dir: string; input: Input; stage: Stage };
export async function bundleRules({ root, dir, input, stage }: BundleOptions) {
    const chunks: string[] = [];
    const read = (file: string) => fs.readFile(path.join(root, 'prompts', file), 'utf8').then(s => s.replace(/\r\n/g, '\n').replace(/^\uFEFF/, ''));
    const add = (file: string, heading: string, text: string) => {
        for (const [i, part] of text.split(/(?=^### )/m).entries()) {
            const title = i ? part.match(/^### (.+)/)![1] : heading;
            chunks.push('出典：' + file + '「' + title + '」\n\n' + part.trim());
        }
    };
    const whole = async (file: string) => {
        const md = await read(file);
        add(file, '冒頭', section(md));
        for (const h of md.matchAll(/^## (.+)$/gm)) add(file, h[1], section(md, h[1]));
    };
    if (isMinutes(input)) {
        const line = section(await read('README.md'), '読み込む範囲').split('\n').find(l => l.startsWith('- 目的が議事録なら'));
        if (!line) throw Error('READMEの議事録の行がありません');
        add('README.md', '読み込む範囲（議事録）', line);
        await whole('meeting.md');
        await whole('minutes.md');
    } else {
        const core = await read('core.md');
        const coreSection = (h: string) => add('core.md', h, section(core, h));
        add('core.md', '冒頭', section(core));
        coreSection('版と保存先');
        const saved = section(core, '保存する設計と成果物');
        if (stage === '設計図') {
            for (const h of ['依頼の受け取り', '主張を先に定める', '資料全体の筋道', '表現を選ぶ順序', '48型の用途と構図', '型が不要な単純図']) coreSection(h);
            const boundary = saved.indexOf('\n- 静止HTML');
            if (boundary < 0) throw Error('設計の箇条の境界がありません');
            add('core.md', '保存する設計と成果物', saved.slice(0, boundary));
            await whole('evidence.md');
            if (transcriptLike(await fs.readFile(path.join(dir, 'material.md'), 'utf8'))) await whole('meeting.md');
            if (input.palette === 'auto') add('references/palettes/PALETTES_100.md', '配色表', await fs.readFile(path.join(root, 'references/palettes/PALETTES_100.md'), 'utf8'));
        } else {
            if (stage === '本番') {
                coreSection('主張を先に定める');
                coreSection('図の共通文法');
            } else {
                if (stage === 'レビュー' || stage === '手直し') add('README.md', '詳細版のレビュー', section(await read('README.md'), '詳細版のレビュー'));
                coreSection('提出前の検査');
            }
            coreSection('描画寸法と色');
            add('core.md', '保存する設計と成果物', outputRules(saved, input.formats));
            if (stage !== '検査') {
                const design = await fs.readFile(path.join(dir, 'design.md'), 'utf8');
                const types = section(core, '48型の用途と構図');
                const selected = typeNumbers(design);
                const lines = types.split('\n').filter(l => selected.some(n => l.startsWith('- ' + n)));
                for (const n of selected) if (!lines.some(l => l.startsWith('- ' + n + ' '))) throw Error('型の行がありません：' + n);
                if (lines.length) add('core.md', '48型の用途と構図', '## 48型の用途と構図\n\n' + lines.join('\n'));
                if (stage === '本番') {
                    for (const id of evidenceNumbers(design)) await whole('evidence/' + id + '.md');
                    const request = await fs.readFile(path.join(dir, 'request.md'), 'utf8') + '\n' + await fs.readFile(path.join(dir, 'material.md'), 'utf8');
                    if (input.formats.includes('html') && /操作可能|インタラクティブ|interactive|スライダ|クリックで|動くHTML/i.test(request)) await whole('interactive.md');
                    if (/アイコン|icon/i.test(design)) await whole('icons.md');
                }
            }
        }
    }
    const name = 'rules-' + stage + '.md';
    await atomicText(path.join(dir, name), chunks.join('\n\n') + '\n');
    return name;
}
export async function prepareRules(options: BundleOptions, log: (line: string) => Promise<void>) {
    try { return await bundleRules(options); }
    catch (error) {
        await log('規則バンドルを作成できないためREADMEを読む指示に戻します：' + String(error).replace(/[\r\n]+/g, ' '));
        return undefined;
    }
}
export function bundledInstruction(name: string, prompts: string) {
    return '規則は ' + name + ' にまとめてあります。制作規則はこれだけを読みます。正本 ' + prompts + '/ を開くのは、rulesに書かれた手本（examples/*.pptx など）を開く時だけです。prompts/ は読み取り専用です。';
}
