'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { estimate, progress, rangeText, timeText, isMinutes, minutesStages, type RecordData } from '../lib/domain';
import { parseWorkChat } from '../lib/work-chat';

interface UserMessage { id: string; time: string; text: string }
interface Props {
    record: RecordData;
    now: number;
    meter: ReturnType<typeof progress>;
    range: ReturnType<typeof estimate>;
    elapsed: number;
    feedback: string;
    onFeedback: (value: string) => void;
    onSend: () => void;
    pending: boolean;
    minutesDirty: boolean;
    pageLabel: string;
    userMessages?: UserMessage[];
}
interface Entry {
    id: string;
    speaker: string;
    time: string;
    text: string;
    operations: string[];
    provider?: 'codex' | 'claude';
    card?: boolean;
}
const clock = (ms: number) => new Date(ms).toLocaleTimeString('ja-JP', { hour12: false });
function Report({ text }: { text: string }) {
    const lines = text.trim().split('\n');
    const long = text.length > 240 || lines.length > 5;
    return <div className="work-chat-card">{long ? <><p>{lines[0].slice(0, 160)}</p><details><summary>詳しく見る</summary><pre>{text}</pre></details></> : <pre>{text}</pre>}</div>;
}
export default function WorkChat({ record, now, meter, range, elapsed, feedback, onFeedback, onSend, pending, minutesDirty, pageLabel, userMessages = [] }: Props) {
    const parsed = useMemo(() => parseWorkChat(record.logs), [record.logs]);
    const logRef = useRef<HTMLDivElement>(null);
    const follow = useRef(true);
    const done = record.status === 'done';
    const minutes = isMinutes(record.input);
    const stageLabel = (stage: string) => minutes ? ({ 設計図: '台帳', 本番: '議事録' } as Record<string, string>)[stage] || stage : stage;
    const stages = minutes ? minutesStages(record.input) : record.selectedLevel === '簡易' ? ['保存', '設計図', '本番', '検査'] : ['保存', '設計図', '本番', '検査', 'レビュー', '手直し'];
    const latestStage = parsed.messages.map(m => m.speaker === 'NEO' && m.text.includes('いまの段階')).lastIndexOf(true);
    const latestAI = parsed.messages.slice(latestStage + 1).reverse().find(m => m.speaker === 'AI');
    const currentWork = latestAI?.operations.at(-1)?.split('\n')[0] || latestAI?.text.split('\n')[0] || stageLabel(record.stage);
    const workKey = record.id + ':' + record.stage + ':' + currentWork;
    const workRef = useRef(workKey);
    const [workStart, setWorkStart] = useState(record.stageStart);
    useEffect(() => {
        if (workRef.current !== workKey) {
            workRef.current = workKey;
            setWorkStart(Math.max(record.stageStart, now));
        }
    }, [workKey, record.stageStart, now]);
    const seconds = Math.max(0, Math.floor(((record.status === 'running' ? now : record.updated) - Math.max(workStart, record.stageStart)) / 1000));
    const entries: Entry[] = [...parsed.messages];
    // Plain CLI output has stage timestamps only. Use that stage's logged time for its report.
    const stageTime = (stage: string) => [...parsed.messages].reverse().find(m => m.speaker === 'NEO' && m.text.includes(stage))?.time || clock(record.updated);
    const reports = [
        ['inspect', '機械検査', record.inspectNote, '検査'],
        ['minutes-inspect', '機械検査', record.minutesCheckNote, 'PDF'],
        ['check', '自己検査', record.check, '検査'],
        ['review', 'レビュー', record.review, 'レビュー'],
        ['review-note', 'レビュー', record.reviewNote, 'レビュー'],
    ];
    for (const [id, speaker, text, stage] of reports) {
        if (text) entries.push({ id: 'report-' + id, speaker: speaker!, time: stageTime(stage!), text, operations: [], card: true });
    }
    entries.push(...userMessages.map(m => ({ ...m, speaker: 'あなた', operations: [] })));
    // Offset times from midnight so requests spanning midnight retain their order.
    const startSeconds = new Date(record.created).getHours() * 3600 + new Date(record.created).getMinutes() * 60 + new Date(record.created).getSeconds();
    const order = (time: string) => { const p = time.split(':').map(Number); const s = p[0] * 3600 + p[1] * 60 + (p[2] || 0); return (s - startSeconds + 86400) % 86400; };
    const signature = entries.map(e => e.id + e.text + e.operations.join('')).join('\n');
    useEffect(() => { follow.current = true; }, [record.id]);
    useEffect(() => {
        if (follow.current && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [signature, record.id]);
    const disabled = !done || record.revisionUsed || pending;
    return <aside className="work-chat" aria-label="作業チャット">
        <div className="work-chat-meters">
            <div className="work-chat-meter-heading"><strong>全体</strong><span className="percent">{meter.percent}%</span><span>経過 {timeText(elapsed)}</span></div>
            <div className="stages">{stages.map((stage, i) => <span key={stage} className={done || i < stages.indexOf(record.stage) ? 'complete' : stage === record.stage ? 'current' : ''}>{done || i < stages.indexOf(record.stage) ? '✓ ' : ''}{stageLabel(stage)}</span>)}</div>
            <div className={'meter' + (record.status === 'running' ? ' moving' : '')} role="progressbar" aria-label="作成の進み具合" aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.percent}><span style={{ width: meter.percent + '%' }}/></div>
            <div className="work-chat-meter-heading hint"><span>残り {done ? '0分' : record.status !== 'running' ? '—' : meter.overtime ? '計算中' : '約' + Math.max(1, Math.ceil(meter.remaining / 60000)) + '分'}</span><span>目安 {rangeText(range)}</span></div>
            {done ? <div className="work-chat-current"><span>直しの残り回数</span><strong>残り {record.revisionUsed ? 0 : 1}回</strong></div> : <div className={'work-chat-current' + (seconds > 60 && record.status === 'running' ? ' work-chat-warning' : '')}><span title={currentWork}>いまの作業：{currentWork}</span><strong>{seconds}秒</strong></div>}
            {!done && <div className="work-chat-current-track" role="meter" aria-label="今の作業の経過秒" aria-valuemin={0} aria-valuemax={Math.max(60, seconds)} aria-valuenow={seconds}><span style={{ width: Math.min(100, seconds / 60 * 100) + '%' }}/></div>}
            <p className="progress-note">{done ? '完了 · 直しは1周まで使えます' : record.status === 'design' ? (minutes ? '台帳' : '設計図') + '完了・あなたの確認待ち' : record.status === 'question' ? '回答を選んでください' : record.status === 'running' ? 'いまの段階：' + stageLabel(record.stage) : record.error || '停止中'}</p>
            {meter.overtime && <p className="error-text">目安より長くかかっています</p>}
        </div>
        <div className="work-chat-log results-text" ref={logRef} onScroll={() => { const el = logRef.current!; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
            {entries.length ? entries.map(entry => <article key={entry.id} className={'work-chat-message' + (entry.speaker === 'あなた' ? ' user-message' : '')}>
                <span className={'work-chat-avatar' + (entry.speaker === 'AI' ? ' ai' : '')} aria-hidden="true">{entry.speaker === 'AI' ? 'AI' : entry.speaker === 'NEO' ? 'NEO' : <span className="icon material-symbols-outlined">{entry.speaker === 'あなた' ? 'person' : 'fact_check'}</span>}</span>
                <div className="work-chat-content"><header><strong>{entry.speaker}{entry.speaker === 'AI' ? ' · ' + (entry.provider === 'claude' || (!entry.provider && record.input.ai.provider === 'claude') ? 'Claude' : 'Codex') : ''}</strong><time>{entry.time || clock(record.created)}</time></header>
                    {entry.card || entry.speaker === '機械検査' ? <Report text={entry.text}/> : entry.text && <p>{entry.text}</p>}
                    {entry.operations.length > 0 && <details className="work-chat-operations"><summary>操作 {entry.operations.length}件</summary><ul>{entry.operations.map((operation, i) => <li key={i}><pre>{operation}</pre></li>)}</ul></details>}
                </div>
            </article>) : <p className="hint">依頼を保存しました。AIの報告を待っています。</p>}
            {record.reason && <p className="hint">{record.reason}</p>}
            <details className="work-chat-full-log"><summary>全文を見る</summary><pre className="logs">{parsed.fullLog || '依頼を保存しました'}</pre></details>
        </div>
        <div className="work-chat-compose feedback-row">
            <label className="sr-only" htmlFor="work-chat-feedback">完了後の直し指示</label>
            <textarea id="work-chat-feedback" aria-label="完了後の直し指示" rows={2} value={feedback} disabled={disabled} onChange={e => onFeedback(e.target.value)} placeholder={record.revisionUsed ? '1周の直しを実施済みです' : !done ? '生成が完了すると直し指示を送れます' : minutes ? '直し指示（1周）例：決定事項を短く' : '直し指示（1周）例：2枚目のグラフを月別に'}/>
            <div className="work-chat-compose-actions"><span className="hint">表示中のページ：{pageLabel || '—'}（指示に自動で添えます）</span><button disabled={disabled || minutesDirty || !feedback.trim()} aria-describedby={minutesDirty ? 'minutes-save-first' : undefined} onClick={onSend}>直しを送る</button></div>
            {minutesDirty && <span id="minutes-save-first" className="hint">先に保存してください</span>}
        </div>
    </aside>;
}
