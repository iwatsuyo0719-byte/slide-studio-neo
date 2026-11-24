export interface TextEdit { before: string; after: string }
export const editFailure = '直せなかった：JSが描いた文字か、同じ文字が複数あるため。AIへの直し指示を使ってください';
export function escapeText(text: string) {
    return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
export function validateEdits(value: unknown): TextEdit[] {
    if (!Array.isArray(value) || !value.length || value.length > 100) throw Error('編集は1〜100件で送ってください');
    return value.map(edit => {
        if (!edit || typeof edit.before !== 'string' || !edit.before.trim() || typeof edit.after !== 'string' || edit.before.length > 2000 || edit.after.length > 2000) throw Error('編集する文字は2,000字までです');
        return { before: edit.before, after: edit.after };
    });
}
// Match decoded visible text only; never replace JavaScript, CSS, attributes or comments.
function decodeText(text: string) {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, key: string) => {
        if (key[0] !== '#') return named[key.toLowerCase()] ?? raw;
        const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw;
    });
}
export function applyTextEdits(source: string, edits: TextEdit[]) {
    // Plan against the original source so one edit cannot change another edit's target.
    const spans: { start: number; end: number; text: string }[] = [];
    const tokens = /<!--[\s\S]*?-->|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<(?:[^>\"']|\"[^\"]*\"|'[^']*')*>|([^<]+)/gi;
    for (const token of source.matchAll(tokens)) {
        if (!token[2]) continue;
        const raw = token[2];
        const offsets: number[] = [];
        let decoded = '';
        const entities = /&(?:#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);|[\s\S]/gi;
        for (const part of raw.matchAll(entities)) {
            const value = decodeText(part[0]);
            for (let i = 0; i < value.length; i++) offsets.push(part.index!);
            decoded += value;
        }
        offsets.push(raw.length);
        spans.push({ start: token.index!, end: token.index! + raw.length, text: decoded });
        // Keep offsets separate from the source to preserve its exact entity spelling.
        maps.set(spans[spans.length - 1], offsets);
    }
    const replacements: { start: number; end: number; value: string; index: number }[] = [];
    const results = edits.map((edit, index) => {
        // 表示テキストのまとまり全体（前後の空白を除く）が一致した所だけを候補にする。
        // 部分一致だと、JSが組み立てた文字が別の本文の一部に当たって、違う場所を書き換えてしまうため。
        // <title>・属性・コメントは spans に入らないので、表紙の見出しと同じ文字の title があっても重複に数えない。
        const want = edit.before.trim();
        const matches: { start: number; end: number }[] = [];
        if (want) for (const span of spans) {
            if (span.text.trim() !== want) continue;
            const at = span.text.length - span.text.trimStart().length;
            const offsets = maps.get(span)!;
            matches.push({ start: span.start + offsets[at], end: span.start + offsets[at + want.length] });
        }
        if (matches.length !== 1) return { ...edit, saved: false, reason: editFailure };
        replacements.push({ ...matches[0], value: escapeText(edit.after), index });
        return { ...edit, saved: true, reason: '' };
    });
    for (const a of replacements) for (const b of replacements) {
        if (a !== b && a.start < b.end && b.start < a.end) {
            results[a.index].saved = false; results[a.index].reason = editFailure;
        }
    }
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
        if (results[replacement.index].saved) source = source.slice(0, replacement.start) + replacement.value + source.slice(replacement.end);
    }
    return { source, results };
}
const maps = new WeakMap<object, number[]>();
