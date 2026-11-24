export interface WorkChatMessage {
    id: string;
    speaker: 'NEO' | 'AI' | '機械検査' | 'あなた';
    /** Logged time, or empty when the retained CLI output has no timestamp. */
    time: string;
    text: string;
    operations: string[];
    provider?: 'codex' | 'claude';
}

export interface WorkChatLog {
    messages: WorkChatMessage[];
    /** Keep every original entry, including output that cannot be interpreted. */
    fullLog: string;
}

const timestamp = /^\[(\d{1,2}:\d{2}:\d{2})\]\s*/;
const role = /^(codex|exec|thinking|user|assistant|claude)(?:\s*:\s*|\s*$)/i;
const cliMarker = /(?:^|\n)(?:codex|exec|thinking|user|assistant|claude|tokens used)\s*:?\s*(?:\n|$)|OpenAI Codex|Claude Code/i;

/** CLI callbacks append overlapping tails of one buffer, rather than new lines. */
function mergeSnapshot(previous: string, next: string): string {
    if (!previous) return next;
    if (next.includes(previous)) return next;
    if (previous.includes(next)) return previous;
    const at = overlapAt(previous, next);
    return at >= 0 ? previous.slice(0, at) + next : previous + '\n' + next;
}

/** previous の末尾と next の先頭が重なる位置（最長の重なり）。next の先頭16字が現れる位置だけを調べ、1字ずつ縮める総当たりをしない。 */
function overlapAt(previous: string, next: string, minimum = 16): number {
    if (next.length < minimum) return -1;
    const probe = next.slice(0, minimum);
    for (let i = previous.indexOf(probe, Math.max(0, previous.length - next.length)); i >= 0; i = previous.indexOf(probe, i + 1)) {
        if (next.startsWith(previous.slice(i))) return i;
    }
    return -1;
}

/** Interpret the existing human-readable CLI log without changing its protocol. */
export function parseWorkChat(logs: readonly string[]): WorkChatLog {
    const messages: WorkChatMessage[] = [];
    let stream = '', streamTime = '', time = '';
    const add = (speaker: WorkChatMessage['speaker'], text: string, operations: string[] = [], provider?: WorkChatMessage['provider'], at = time) => {
        if (!text.trim() && !operations.length) return;
        messages.push({ id: `log-${messages.length}`, speaker, time: at, text: text.trim(), operations, ...(provider ? { provider } : {}) });
    };
    const flush = () => {
        if (!stream.trim()) return;
        const codex = /OpenAI Codex|(?:^|\n)codex\s*(?:\n|$)/i.test(stream);
        let mode: 'report' | 'operation' | 'ignore' = codex ? 'ignore' : 'report';
        let report: string[] = [], operation: string[] = [], operations: string[] = [];
        // A retained tail may have lost its role header. Let the caller use the
        // record's provider instead of falsely identifying that output as Claude.
        let provider: WorkChatMessage['provider'] = codex ? 'codex' : /Claude Code|(?:^|\n)claude\s*:/i.test(stream) ? 'claude' : undefined;
        const finishOperation = () => {
            const text = operation.join('\n').trim();
            if (text) operations.push(text);
            operation = [];
        };
        const finishReport = () => {
            const text = report.join('\n').trim();
            if (text) {
                add('AI', text, operations, provider, streamTime);
                operations = [];
            }
            report = [];
        };
        for (const raw of stream.split('\n')) {
            const line = raw.trimEnd(), trimmed = line.trim();
            const marker = trimmed.match(role);
            if (marker) {
                finishOperation();
                finishReport();
                const name = marker[1].toLowerCase();
                if (name === 'codex' || name === 'assistant' || name === 'claude') {
                    mode = 'report';
                    if (name !== 'assistant') provider = name as 'codex' | 'claude';
                    const inline = trimmed.slice(marker[0].length).trim();
                    if (inline) report.push(inline);
                } else mode = name === 'exec' ? 'operation' : 'ignore';
                continue;
            }
            if (/^tokens used\b/i.test(trimmed)) {
                finishOperation(); finishReport(); mode = 'ignore'; continue;
            }
            // Codex's result header marks the end of the command, before stdout.
            if (mode === 'operation' && /\b(?:succeeded|exited|failed)(?:\s|:)/i.test(line)) {
                const command = line.replace(/\s+(?:in\s+.*?\s+)?(?:succeeded|exited|failed)\b.*$/i, '').trim();
                if (command) operation.push(command);
                finishOperation(); mode = 'ignore'; continue;
            }
            if (/^(?:OpenAI Codex|Claude Code|[-─]{3,}|workdir:|model:|provider:|approval:|sandbox:|reasoning effort:|reasoning summaries:|session id:|mcp startup:)/i.test(trimmed)) continue;
            if (mode === 'report') report.push(line);
            if (mode === 'operation') operation.push(line);
        }
        finishOperation(); finishReport();
        if (operations.length) add('AI', '操作を実行しています', operations, provider, streamTime);
        stream = '';
    };
    for (const original of logs) {
        const entry = original.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r\n?/g, '\n');
        const stamp = entry.match(timestamp);
        const body = stamp ? entry.slice(stamp[0].length) : entry;
        if (!body.trim()) continue;
        // The timestamped final CLI copy still belongs to the same output stream.
        // 時刻付きの短いNEO行（「完了しました」等）は、AIの出力に同じ文字列があっても吸収しない
        const overlaps = () => !!stream && body.length >= 200 && (body.includes(stream) || stream.includes(body) || overlapAt(stream, body) >= 0);
        if (!stamp || cliMarker.test(body) || overlaps()) {
            if (!stream) streamTime = stamp?.[1] || time;
            stream = mergeSnapshot(stream, body);
            continue;
        }
        flush();
        time = stamp[1];
        const speaker = /機械検査|check-auto/i.test(body) ? '機械検査' : 'NEO';
        // Repeated persisted copies of one server event must not create bubbles.
        const last = messages[messages.length - 1];
        if (last?.speaker !== speaker || last.time !== time || last.text !== body.trim()) add(speaker, body);
    }
    flush();
    return { messages, fullLog: logs.join('\n\n') };
}
