export type Provider = 'claude' | 'codex';
export type Level = '簡易' | '詳細' | 'AUTO';
export type Depth = 'auto' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export type Format = 'pptx' | 'html';
export type Purpose = '提案' | '報告' | '議事録' | '説明・研修';
export interface AIChoice {
    provider: Provider;
    model: string;
    depth: Depth;
}
export interface Settings extends AIChoice {
    models: Record<Provider, string[]>;
    minimum: Record<Provider, Depth>;
    reviewMinimum: Depth;
}
export interface Palette {
    id: string;
    name: string;
    group: string;
    mood: string;
    colors: string[];
}
export interface Input {
    title: string;
    audience: '社内' | '社外';
    purpose: Purpose;
    formats: Format[];
    level: Level;
    palette: string;
    brand: string;
    material: string;
    ai: AIChoice;
}
export type Stage = '保存' | '設計図' | '本番' | '検査' | 'レビュー' | '手直し';
export type Status = 'running' | 'question' | 'design' | 'done' | 'error' | 'stopped';
export interface Question {
    text: string;
    options: string[];
}
export interface RecordData {
    minutes?: string;
    pdfNote?: string;
    fake?: boolean;
    id: string;
    title: string;
    input: Input;
    status: Status;
    stage: Stage;
    selectedLevel: '簡易' | '詳細' | null;
    reason: string;
    created: number;
    updated: number;
    phaseStart: number;
    activeMs: number;
    phase: 'design' | 'production';
    stageStart: number;
    design: string;
    check: string;
    review: string;
    logs: string[];
    files: string[];
    question?: Question;
    asked: boolean;
    answer?: string;
    revisionUsed: boolean;
    error?: string;
    reviewer?: Provider;
    reviewFallback?: boolean;
    paletteCandidates?: string[];
    chosenPalette?: string;
    resumeStage?: Stage;
    pausedStatus?: 'design' | 'question';
    attempt: number;
    timings: Partial<Record<Stage, number>>;
}
export interface HistorySample {
    key: string;
    phase: 'design' | 'production';
    ms: number;
}
export const purposes: Record<Purpose, {
    goal: string;
    structure: string;
}> = {
    '提案': { goal: '読み手に決めてもらう', structure: '結論→根拠→打ち手→お願い（決めてほしいこと）' },
    '報告': { goal: '結果・進捗を正しく伝える', structure: '結果→要因→次の一手' },
    '議事録': { goal: '会議で決まったことと宿題を記録し、関係者に配る', structure: '冒頭情報（会議名・日時・参加者）→決定事項→宿題（担当・内容・期限の表）→論点と経緯（なぜそう決まったか）→次回の確認事項。meeting.md の台帳の規則で事実を拾い、minutes.md で文書にする' },
    '説明・研修': { goal: '仕組み・手順をわかってもらう', structure: '全体像→部分→まとめ' }
};
export const defaults: Settings = { provider: 'claude', model: 'opus', depth: 'auto', models: { claude: ['opus', 'fable'], codex: ['gpt-6.1-sol', 'gpt-5.6-sol'] }, minimum: { claude: 'medium', codex: 'medium' }, reviewMinimum: 'high' };
export const depths: Record<Provider, Depth[]> = { claude: ['medium', 'high', 'xhigh', 'max'], codex: ['medium', 'high', 'xhigh', 'max', 'ultra'] };
export function allowedModels(s: Settings, p: Provider) { return s.models[p].filter(m => defaults.models[p].includes(m)); }
export function allowedDepths(s: Settings, p: Provider, review = false) { const list = depths[p]; const min = review ? s.reviewMinimum : s.minimum[p]; return list.slice(Math.max(review ? 1 : 0, list.indexOf(min))); }
export function effectiveAI(ai: AIChoice, level: Level, s: Settings = defaults, review = false): AIChoice { const list = allowedDepths(s, ai.provider, review); const desired = ai.depth === 'auto' ? (level === '簡易' ? 'medium' : 'high') : ai.depth; return { ...ai, model: allowedModels(s, ai.provider).includes(ai.model) ? ai.model : allowedModels(s, ai.provider)[0], depth: list.includes(desired) ? desired : list[0] }; }
export function validateSettings(raw: unknown): Settings {
    const s = raw as Settings;
    if (!s || !['claude', 'codex'].includes(s.provider) || !s.models || !s.minimum)
        throw Error('設定の形式が正しくありません');
    for (const p of ['claude', 'codex'] as Provider[]) {
        if (!Array.isArray(s.models[p]) || !s.models[p].length || s.models[p].some(m => !defaults.models[p].includes(m)) || !depths[p].includes(s.minimum[p]))
            throw Error('品質の下限・モデル候補が不正です');
    }
    if (!['high', 'xhigh', 'max'].includes(s.reviewMinimum) || !allowedModels(s, s.provider).includes(s.model) || (s.depth !== 'auto' && !allowedDepths(s, s.provider).includes(s.depth)))
        throw Error('モデルまたは深さが下限を満たしていません');
    return s;
}
export function validateInput(raw: unknown, s: Settings): Input {
    const i = raw as Input;
    if (!i || typeof i.title !== 'string' || typeof i.material !== 'string' || (!isMinutes(i) && (typeof i.brand !== 'string' || typeof i.palette !== 'string')) || !['社内', '社外'].includes(i.audience) || !Object.hasOwn(purposes, i.purpose) || (!isMinutes(i) && !['簡易', '詳細', 'AUTO'].includes(i.level)) || !Array.isArray(i.formats) || !i.formats.length || i.formats.some(f => !['pptx', 'html'].includes(f)) || !i.ai || !['claude', 'codex'].includes(i.ai.provider))
        throw Error('入力の形式が正しくありません');
    if (!allowedModels(s, i.ai.provider).includes(i.ai.model) || (i.ai.depth !== 'auto' && !allowedDepths(s, i.ai.provider).includes(i.ai.depth)))
        throw Error('AIの品質の下限を満たしていません');
    if (i.material.length > 500000)
        throw Error('貼り付けは50万文字までです。長い素材はファイルを添付してください');
    if (!isMinutes(i) && i.palette === 'brand' && !/^#[0-9a-f]{6}$/i.test(i.brand))
        throw Error('ブランド色は # と6桁のHEXで入力してください');
    return { ...i, ...(isMinutes(i) ? { palette: '', brand: '', level: '詳細' as const } : {}), title: i.title.slice(0, 120), material: i.material.slice(0, 500000), formats: [...new Set(i.formats)] };
}
export function isMinutes(input: Pick<Input, 'purpose'>) { return input.purpose === '議事録'; }
export function parsePalettes(md: string): Palette[] {
    let group = '';
    const out: Palette[] = [];
    for (const line of md.split(/\r?\n/)) {
        const h = line.match(/^## \d\. (.+?)（/);
        if (h) {
            group = h[1];
            continue;
        }
        const cells = line.split('|').map(s => s.trim().replaceAll('**', ''));
        if (/^\d{3}$/.test(cells[1] || '') && cells.length >= 10) {
            const colors = cells.slice(4, 9);
            if (colors.some(c => !/^#[0-9A-F]{6}$/i.test(c)))
                throw Error('配色HEXが不正です');
            out.push({ id: cells[1], name: cells[2].replace('（既定）', ''), mood: cells[3], group, colors });
        }
    }
    if (out.length !== 100 || new Set(out.map(p => p.id)).size !== 100 || new Set(out.map(p => p.group)).size !== 4 || !out.find(p => p.id === '026'))
        throw Error('配色100組・4系統を確認できません');
    return out;
}
export function requestText(i: Input, palettes: Palette[], files: string[] = []) { const p = palettes.find(p => p.id === i.palette); return ['何を：' + (i.title || (isMinutes(i) ? '素材から会議名を決めて議事録を作る' : '素材から題名を決めてスライドを作る')), '読み手：' + i.audience + (i.audience === '社外' ? '。敬体とし、出所を厳密に確かめる' : ''), '目的：' + i.purpose + '。' + purposes[i.purpose].goal + '。骨組み：' + purposes[i.purpose].structure + '。素材中の指定を優先する', '素材：material.md' + (files.length ? '、attachments/ の ' + files.join('、') : ''), isMinutes(i) ? '出力：議事録 minutes.md（Markdown正本）。PDFはツールが作る' : '出力：' + i.formats.join(' ＋ '), '版：' + (isMinutes(i) ? '詳細・止まらず完成まで（固定）' : i.level) + (!isMinutes(i) && i.level === 'AUTO' ? '。読み手・種類・素材量からAIが簡易または詳細を選び、理由を1行示す' : ''), '配色：' + (isMinutes(i) ? '使わない（議事録）' : i.palette === 'auto' ? 'おまかせ。詳細は近い3組と比較HTMLを提示、簡易は1組を決定' : i.palette === 'brand' ? 'ブランド色 ' + i.brand : p ? p.id + ' ' + p.name + ' ' + p.colors.join(' ') : '026 浅瀬アクア')].join('\n') + '\n'; }
export const secretKeys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
export function subscriptionEnv(env: Record<string, string | undefined>) { return Object.fromEntries(Object.entries(env).filter(([k]) => !secretKeys.includes(k.toUpperCase()))) as NodeJS.ProcessEnv; }
export function historyKey(i: Input, level: Level, s: Settings = defaults) { if (isMinutes(i)) level = '詳細'; const a = effectiveAI(i.ai, level, s); return [a.provider, a.model, a.depth, level, isMinutes(i) ? 'minutes' : [...i.formats].sort().join('+')].join('|'); }
export function estimate(i: Input, level: Level, phase: 'design' | 'production', history: HistorySample[] = [], s: Settings = defaults): [
    number,
    number
] {
    if (isMinutes(i)) { level = '詳細'; phase = 'production'; }
    const samples = history.filter(h => h.key === historyKey(i, level, s) && h.phase === phase).map(h => h.ms).sort((a, b) => a - b);
    if (samples.length >= 3) {
        const mid = Math.floor(samples.length / 2);
        const med = samples.length % 2 ? samples[mid] : (samples[mid - 1] + samples[mid]) / 2;
        return [med * .8, med * 1.2];
    }
    if (isMinutes(i)) {
        return [15 * 60000, 25 * 60000];
    }
    // 2026-11-09 実測1件（簡易HTML：設計図4分・本番16分・検査10分）から更新。
    let mins: [
        number,
        number
    ] = level === '詳細' ? (phase === 'design' ? [4, 8] : [35, 60]) : [20, 35];
    if (level === 'AUTO')
        mins = phase === 'design' ? [4, 35] : [20, 60];
    if (i.formats.length === 2 && phase === 'production')
        mins = [mins[0] + 5, mins[1] + 5];
    return [mins[0] * 60000, mins[1] * 60000];
}
export function progress(r: RecordData, now: number, range: [
    number,
    number
]) {
    if (r.status === 'done')
        return { percent: 100, remaining: 0, overtime: false };
    if (r.status === 'design')
        return { percent: 99, remaining: 0, overtime: false };
    const continuousMinutes = r.input && isMinutes(r.input);
    const stages: Stage[] = continuousMinutes ? ['保存', '設計図', '本番', '検査', 'レビュー', '手直し'] : r.phase === 'design' ? ['保存', '設計図'] : r.selectedLevel === '詳細' ? ['本番', '検査', 'レビュー', '手直し'] : ['本番', '検査'];
    // 設計図は別メーター。本番:検査は実測16:10、詳細のレビュー8分・手直し8分は推定。
    const weights = continuousMinutes ? [.02, .18, .35, .15, .15, .15] : r.phase === 'design' ? [.05, .95] : r.selectedLevel === '詳細' ? [16 / 42, 10 / 42, 8 / 42, 8 / 42] : [16 / 26, 10 / 26];
    const index = Math.max(0, stages.indexOf(r.stage));
    const base = weights.slice(0, index).reduce((a, b) => a + b, 0);
    const elapsed = Math.max(0, (r.status === 'running' ? now : r.updated) - r.stageStart);
    const part = Math.min(.96, elapsed / (range[1] * weights[index]));
    const waiting = ['design', 'question', 'error', 'stopped'].includes(r.status);
    const total = r.activeMs + (r.status === 'running' ? Math.max(0, now - r.phaseStart) : 0);
    return { percent: Math.min(99, Math.floor((base + part * weights[index]) * 100)), remaining: Math.max(0, range[1] - total), overtime: !waiting && total > range[1] };
}
export function timeText(ms: number) { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
export function rangeText(r: [
    number,
    number
]) { return '約' + Math.max(1, Math.round(r[0] / 60000)) + '〜' + Math.max(1, Math.round(r[1] / 60000)) + '分'; }

// Normalize only the reusable form input; historical records keep their original purpose.
export function historyInput(input: Input): Input {
    return { ...input, purpose: Object.hasOwn(purposes, input.purpose) ? input.purpose : '議事録' };
}
export function requestTitle(input: Input, files: { name: string }[] = []): string {
    const fallback = isMinutes(input) ? '議事録' : 'スライド';
    const line = input.material.split(/\r?\n/).map(line => line.trim()).find(line =>
        line && !/^(?:（.*）|\(.*\)|【.*】|\[.*\])$/.test(line) && /[\p{L}\p{N}]/u.test(line));
    const title = input.title.trim() || line?.slice(0, 24) || (!isMinutes(input) && files[0]?.name) || fallback;
    return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\.+/g, '-').slice(0, 60) || fallback;
}
