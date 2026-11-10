'use client';
import { useEffect, useRef, useState } from 'react';
import { historyInput, isMinutes, allowedDepths, allowedModels, defaults, effectiveAI, estimate, progress, rangeText, timeText, type Input, type Settings, type Palette, type RecordData, type HistorySample, type Provider } from '../lib/domain';
import type { CLIStatus } from '../server/cli';
import PalettePanel from './PalettePanel';
import MinutesEditor from './MinutesEditor';
interface Bootstrap {
    settings: Settings;
    palettes: Palette[];
    history: HistorySample[];
    cli: Record<Provider, CLIStatus>;
    token: string;
    fake: boolean;
}
const initial: Input = { title: '', audience: '社内', purpose: '提案', formats: ['pptx'], level: 'AUTO', palette: '026', brand: '#225966', material: '', ai: { provider: 'claude', model: 'opus', depth: 'auto' } };
const label = (p: Provider) => p === 'claude' ? 'Claude Code' : 'Codex';
function Heading({ n, children, hint }: {
    n: number;
    children: React.ReactNode;
    hint?: string;
}) { return <h2><b className="number">{n}</b>{children}{hint && <small>{hint}</small>}</h2>; }
function Icon({ name }: {
    name: string;
}) { return <span className="icon material-symbols-outlined" aria-hidden="true">{name}</span>; }
function Discover({ children, onClick, disabled = false }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
}) { return <button className="discover" onClick={onClick} disabled={disabled}><span className="fill"/><span className="arrow" aria-hidden="true">→</span><span className="button-text">{children}</span></button>; }
export default function Studio() {
    const [boot, setBoot] = useState<Bootstrap | null>(null), [input, setInput] = useState<Input>(initial), [files, setFiles] = useState<File[]>([]), [record, setRecord] = useState<RecordData | null>(null), [error, setError] = useState(''), [pending, setPending] = useState(false), [now, setNow] = useState(Date.now()), [drawer, setDrawer] = useState<'settings' | 'ai' | 'history' | null>(null), [settingsDraft, setSettingsDraft] = useState<Settings>(defaults), [records, setRecords] = useState<RecordData[]>([]), [edge, setEdge] = useState(true), [feedback, setFeedback] = useState(''), [candidate, setCandidate] = useState(''), [previewSelection, setPreview] = useState<{ id: string; file: string } | null>(null), [notice, setNotice] = useState('');
    const drawerRef = useRef<HTMLElement>(null), lastFocus = useRef<HTMLElement | null>(null), upload = useRef<HTMLInputElement>(null);
    const active = !!record, done = record?.status === 'done', waiting = record?.status === 'design';
    const minutes = isMinutes(record?.input || input);
    const designLabel = minutes ? '台帳' : '設計図';
    // Derive the initial preview in the same render as done; an effect leaves a blank first frame.
    const preview = record && !minutes ? (previewSelection?.id === record.id && record.files.includes(previewSelection.file) ? previewSelection.file : record.files.includes('index.html') ? 'index.html' : record.files.find(f => f.startsWith('preview/')) || '') : '';
    const [minutesDirty, setMinutesDirty] = useState(false);
    const patch = (p: Partial<Input>) => setInput(i => ({ ...i, ...p }));
    async function load(refresh = false) {
        const response = await fetch('/api/neo' + (refresh ? '?refresh=1' : ''));
        const b = await response.json();
        if (!response.ok)
            throw Error(b.error);
        setBoot(b);
        return b as Bootstrap;
    }
    useEffect(() => { void load().then(b => { setInput(i => ({ ...i, ai: { provider: b.settings.provider, model: b.settings.model, depth: b.settings.depth } })); setSettingsDraft(b.settings); }).catch(e => setError(String(e))); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
    useEffect(() => {
        if (!record || record.status !== 'running')
            return;
        let cancelled = false;
        const t = setInterval(() => {
            void fetch('/api/neo?id=' + encodeURIComponent(record.id)).then(async (response) => {
                const r = await response.json();
                if (!response.ok)
                    throw Error(r.error);
                if (!cancelled) {
                    setRecord(r);
                    if (r.status === 'design')
                        setEdge(true);
                }
            }).catch(e => {
                if (!cancelled)
                    setError(String(e));
            });
        }, 600);
        return () => { cancelled = true; clearInterval(t); };
    }, [record?.id, record?.status]);
    useEffect(() => {
        if (record?.status === 'done') {
            void load().catch(() => { });
        }
    }, [record?.id, record?.status]);
    useEffect(() => {
        if (!drawer && !waiting)
            return;
        lastFocus.current = document.activeElement as HTMLElement;
        const timer = setTimeout(() => drawerRef.current?.querySelector<HTMLElement>('button,input,select')?.focus(), 30);
        const handle = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setDrawer(null);
                if (waiting)
                    setEdge(false);
            }
            if (e.key === 'Tab' && drawer) {
                const focusable = drawerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],textarea');
                if (!focusable?.length)
                    return;
                const first = focusable[0], last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
                if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', handle);
        return () => { clearTimeout(timer); document.removeEventListener('keydown', handle); lastFocus.current?.focus(); };
    }, [drawer, waiting]);
    async function post(body: unknown) {
        if (!boot)
            throw Error('初期化中です');
        const response = await fetch('/api/neo', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-neo-token': boot.token }, body: JSON.stringify(body) });
        const result = await response.json();
        if (!response.ok)
            throw Error(result.error);
        return result;
    }
    async function operation(work: () => Promise<void>) {
        if (pending)
            return;
        setPending(true);
        setError('');
        try {
            await work();
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setPending(false);
        }
    }
    async function act(action: string, extra: Record<string, unknown> = {}) {
        if (!record || (action === 'revise' && minutesDirty))
            return;
        await operation(async () => {
            const r = await post({ action, id: record.id, ...extra });
            setRecord(r);
            if (action === 'save-minutes')
                setNotice(r.pdfNote ? 'Markdownを保存しました' : 'Markdownを保存し、PDFを作り直しました');
            if (action === 'design-revise' || action === 'revise')
                setFeedback('');
        });
    }
    async function start() {
        await operation(async () => {
            if (!boot)
                return;
            const form = new FormData();
            form.append('input', JSON.stringify(input));
            files.forEach(f => form.append('files', f));
            const response = await fetch('/api/neo', { method: 'POST', headers: { 'x-neo-token': boot.token }, body: form });
            const r = await response.json();
            if (!response.ok)
                throw Error(r.error);
            setRecord(r);
            setEdge(true);
            setNotice('');
            setFeedback('');
        });
    }
    async function openDrawer(which: 'history' | 'settings' | 'ai') {
        setError('');
        if (which === 'history') {
            await operation(async () => {
                const response = await fetch('/api/neo?history=1');
                const all = await response.json();
                if (!response.ok)
                    throw Error(all.error);
                setRecords(all);
                setDrawer(which);
            });
        }
        else {
            if (which === 'settings' && boot)
                setSettingsDraft(structuredClone(boot.settings));
            if (which === 'ai' && boot)
                setSettingsDraft({ ...structuredClone(boot.settings), ...input.ai });
            setDrawer(which);
        }
    }
    const selectedAI = record?.input.ai || input.ai;
    const ai = effectiveAI(selectedAI, minutes ? '詳細' : record?.selectedLevel || input.level, boot?.settings || defaults);
    // Fake timings measure the test delay, not document generation time.
    const estimateHistory = boot?.fake ? [] : boot?.history;
    const phaseRange = estimate(record?.input || input, record?.selectedLevel || input.level, record?.phase || (input.level === '詳細' ? 'design' : 'production'), estimateHistory, boot?.settings || defaults);
    const range = phaseRange;
    const meter = record ? progress(record, now, range) : null;
    const fieldButtons = <T extends string>(items: T[], current: T, onSelect: (v: T) => void) => <div className="segments">{items.map(v => <button key={v} className={current === v ? 'on' : ''} aria-pressed={current === v} onClick={() => onSelect(v)}>{v}</button>)}</div>;
    const fileURL = (name: string, inline = false) => '/api/files/' + encodeURIComponent(record!.id) + '/' + name.split('/').map(encodeURIComponent).join('/') + (inline ? '?preview=1' : '');
    const elapsed = record ? record.activeMs + (record.status === 'running' ? Math.max(0, now - record.phaseStart) : 0) : 0;
    const downloadLinks = record?.files.filter(f => minutes ? f === 'minutes.md' || f === 'minutes.pdf' : f === 'index.html' || f === 'slides.pptx') || [];
    return <main className="studio"><header className="topbar"><span className="logo">SLIDE STUDIO NEO</span><button className="ai-chip" disabled={active || !boot} onClick={() => void openDrawer('ai')} title="この依頼だけAIを変更"><i className={boot?.cli[ai.provider].usable ? 'dot' : 'dot unavailable'}/><strong>{label(ai.provider)}</strong>・{ai.model}・{ai.depth}{selectedAI.depth === 'auto' ? '（自動）' : ''}</button><span className="status-line">{boot?.fake ? '偽AIモード · 利用枠を使いません' : boot?.cli[ai.provider].message || 'CLIを確認中…'}</span><span className="spacer"/><button disabled={pending} onClick={() => void openDrawer('history')}><Icon name="history"/>履歴</button><button onClick={() => void openDrawer('settings')}><Icon name="settings"/>設定</button></header>
 
 {(error || notice) && <div role={error ? 'alert' : 'status'} className={error ? 'message error' : 'message'}>{error || notice}<button aria-label="通知を閉じる" onClick={() => { setError(''); setNotice(''); }}>×</button></div>}
 <div className="main-grid"><fieldset className={'left-column ' + (active ? 'locked' : '')} disabled={active || pending}><label className="title-label"><span className="sr-only">題名</span><input className="title-input" aria-label="題名" placeholder="題名（任意・空なら素材から自動）" value={input.title} onChange={e => patch({ title: e.target.value })}/></label><div className="two"><section><Heading n={1}>読み手</Heading>{fieldButtons(['社内', '社外'], input.audience, v => patch({ audience: v }))}</section><section><Heading n={2} hint={minutes ? undefined : "両方も可"}>出力形式</Heading>{minutes ? <p className="fixed-format">Markdown＋PDF（固定）</p> : <div className="segments">{(['pptx', 'html'] as const).map(f => <button key={f} aria-pressed={input.formats.includes(f)} className={input.formats.includes(f) ? 'on' : ''} onClick={() => patch({ formats: input.formats.includes(f) ? input.formats.length === 1 ? input.formats : input.formats.filter(x => x !== f) : [...input.formats, f] })}>{f}</button>)}</div>}</section></div><section><Heading n={3} hint="資料の種類">目的</Heading><div className="purpose-grid">{(['提案', '報告', '説明・研修', '議事録'] as const).map((p, i) => <button key={p} className={input.purpose === p ? 'on' : ''} aria-pressed={input.purpose === p} onClick={() => patch({ purpose: p })}><Icon name={['adjust', 'trending_up', 'diamond', 'description'][i]}/>{p}</button>)}</div></section><section><Heading n={4}>レベル</Heading>{minutes ? <p className="fixed-format">詳細・止まらず完成まで（固定）</p> : fieldButtons(['簡易', '詳細', 'AUTO'], input.level, v => patch({ level: v }))}<p className="level-hint">{minutes ? '台帳から議事録・検査・レビュー・1周の手直しまで自動で進みます' : { 簡易: '設計図で止めずに本番まで。1〜3枚、自己検査だけ', 詳細: '設計図で止めてOKを待ち、レビューと1周の手直しまで', AUTO: 'AIが読み手・種類・素材の量から簡易か詳細を選び、理由を1行出します' }[input.level]}</p></section></fieldset>
 <section className="right-column" aria-live="polite">{!record ? <><Heading n={5} hint="貼り付けかファイル">素材</Heading><label className="sr-only" htmlFor="material">素材を貼り付け</label><textarea id="material" className="material" value={input.material} onChange={e => patch({ material: e.target.value })} placeholder="打合せの文字起こし・メモ・数字を貼り付け（整形不要）"/><div className="drop-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); setFiles(f => [...f, ...Array.from(e.dataTransfer.files)]); }}><button className="file-select" onClick={() => upload.current?.click()}>ファイルを置く／選ぶ</button><span>（txt・md・docx・pdf・xlsx・csv・pptx・画像）</span><input type="file" multiple hidden ref={upload} aria-label="ファイル添付" accept=".txt,.md,.docx,.pdf,.xlsx,.csv,.pptx,.png,.jpg,.jpeg,.webp" onChange={e => { setFiles(f => [...f, ...Array.from(e.target.files || [])]); e.target.value = ''; }}/>{files.length > 0 && <ul className="attachments">{files.map((f, i) => <li key={i}>{f.name}<button aria-label={f.name + 'を外す'} onClick={() => setFiles(files.filter((_, n) => n !== i))}>×</button></li>)}</ul>}</div></> : done ? <><div className="result-top"><h2>できあがりました</h2>{minutes && record.pdfPageNote && <span className="pdf-page-note" role="status">{record.pdfPageNote}</span>}<span className="hint">{record.selectedLevel}版 · {timeText(elapsed)}</span></div><div className="result-grid"><div className={'preview-area' + (minutes ? ' minutes-preview' : '')}>{minutes ? <MinutesEditor key={record.id + ':' + record.updated} markdown={record.minutes || ''} pending={pending} onDirtyChange={setMinutesDirty} onSave={minutes => void act('save-minutes', { minutes })}/>: preview ? (preview.endsWith('.html') ? <iframe title="成果物プレビュー" sandbox="allow-scripts" src={fileURL(preview, true)}/> : <img alt="pptxページのプレビュー" src={fileURL(preview, true)}/>) : <div className="no-preview">ページ画像を作成できませんでした。<br />pptxをダウンロードして確認してください。</div>}{!minutes && record.files.filter(f => f === 'index.html' || f.startsWith('preview/')).length > 1 && <div className="thumbnails">{record.files.filter(f => f === 'index.html' || f.startsWith('preview/')).map((f, i) => <button key={f} onClick={() => setPreview({ id: record.id, file: f })}>{f === 'index.html' ? 'HTML' : 'ページ ' + (i + 1)}</button>)}</div>}</div><div className="results-text"><h3>検査結果・改善案</h3><pre>{record.check || '検査結果はありません'}</pre>{record.reviewNote && <p role="status">{record.reviewNote}</p>}{record.review && <><h3>レビュー結果</h3><pre>{record.review}</pre></>}{minutes && <details className="minutes-ledger"><summary>台帳を読む</summary><pre>{record.design || '台帳はありません'}</pre></details>}{record.logs.at(-2) && <details><summary>生成ログ</summary><pre>{record.logs.join('\n')}</pre></details>}</div></div><div className="feedback-row"><input aria-label="完了後の直し指示" value={feedback} disabled={record.revisionUsed || pending} onChange={e => setFeedback(e.target.value)} placeholder={record.revisionUsed ? '1周の直しを実施済みです' : minutes ? '直し指示（1周）例：決定事項を短く' : '直し指示（1周）例：2枚目のグラフを月別に'}/><button aria-describedby={minutesDirty ? "minutes-save-first" : undefined} disabled={record.revisionUsed || pending || minutesDirty || !feedback.trim()} onClick={() => void act('revise', { feedback })}>直しを送る</button>{minutesDirty && <span id="minutes-save-first" className="hint">先に保存してください</span>}</div></> : <><div className="progress-card"><p className="hint">{record.title} ／ {record.selectedLevel || 'AUTOで判定中'}{record.selectedLevel ? '版' : ''} ／ {minutes ? 'Markdown＋PDF' : record.input.formats.join(' + ')}</p>{record.reason && <p className="auto-reason">{record.reason}</p>}<div className={'meter ' + (record.status === 'running' ? 'moving' : '')} role="progressbar" aria-label="作成の進み具合" aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter!.percent}><span style={{ width: meter!.percent + '%' }}/></div><div className="numbers"><strong className="percent">{meter!.percent}%</strong><span>残り <b>{waiting ? '—' : meter!.overtime ? '計算中' : '約' + Math.max(1, Math.ceil(meter!.remaining / 60000)) + '分'}</b></span><span>経過 <b>{timeText(elapsed)}</b></span><span>目安 <b>{!minutes && record.phase === 'design' ? designLabel + 'まで ' : ''}{rangeText(range)}</b></span></div><div className="stages">{(!minutes && record.selectedLevel === '簡易' ? ['保存', '設計図', '本番', '検査'] : ['保存', '設計図', '本番', '検査', 'レビュー', '手直し']).map((st, i, all) => { const at = all.indexOf(record.stage); return <span key={st} className={i < at ? 'complete' : i === at ? 'current' : ''}>{i < at ? '✓ ' : ''}{minutes ? ({ 設計図: '台帳', 本番: '議事録' } as Record<string, string>)[st] || st : st}</span>; })}</div><p className="progress-note">{waiting ? designLabel + '完了・あなたの確認待ち' : record.status === 'question' ? '回答を選んでください' : record.status === 'running' ? 'いまの段階：' + (minutes ? ({ 設計図: '台帳', 本番: '議事録' } as Record<string, string>)[record.stage] || record.stage : record.stage) : record.error}</p>{meter!.overtime && <p className="error-text">目安より長くかかっています</p>}<details><summary>AIの出力ログ</summary><pre className="logs">{record.logs.join('\n') || '依頼を保存しました'}</pre></details></div>{record.status === 'question' && record.question && <section className="question"><h3>{record.question.text}</h3>{record.question.options.map(o => <button key={o} disabled={pending} onClick={() => void act('answer', { answer: o })}>{o}</button>)}</section>}{['error', 'stopped'].includes(record.status) && <section className="recovery"><p>依頼・途中の成果物は保存してあります。上限が解けたら『再開』で、止まった段から続けます。</p><button disabled={pending} onClick={() => void act('resume')}>再開</button><button disabled={pending} onClick={() => setRecord(null)}>入力に戻る</button></section>}</>}</section></div>
 <PalettePanel palettes={boot?.palettes || []} value={record?.chosenPalette || record?.input.palette || input.palette} brand={input.brand} onChange={palette => patch({ palette })} onBrand={brand => patch({ brand })} disabled={active || minutes} unavailableReason={minutes ? '議事録では配色を使いません' : undefined}/>
 <footer className="footer"><div className="footer-actions">{done && downloadLinks.map(f => <a className="download" key={f} href={fileURL(f)} download>{f === 'minutes.md' ? 'Markdown' : f === 'minutes.pdf' ? 'PDF' : f === 'index.html' ? 'HTML' : 'pptx'}をダウンロード</a>)}{done && minutes && record.pdfNote && <span className="pdf-note" role="status">{record.pdfNote}</span>}{record && <button disabled={pending} onClick={() => void operation(async () => { const r = await post({ action: 'open-folder', id: record.id }); setNotice('保存先：' + r.path); })}>フォルダを開く</button>}</div><span className="spacer"/><p className="estimate">{waiting ? 'あなたの確認待ち' : done ? '完了' : <>{!minutes && (record?.phase === 'design' || (!record && input.level === '詳細')) ? designLabel + 'までの目安' : '生成時間の目安'} <b>{rangeText(range)}</b>{!record && !minutes && input.level === 'AUTO' ? '（AUTOのため幅あり）' : ''}</>}</p>{!record ? <><b className="number">7</b><Discover disabled={pending || !boot || !boot.cli[input.ai.provider].usable || (!input.material.trim() && !files.length) || (!minutes && input.palette === 'brand' && !/^#[\da-f]{6}$/i.test(input.brand))} onClick={() => void start()}>{pending ? '保存中…' : '作成する'}</Discover></> : done ? <Discover disabled={pending} onClick={() => { setRecord(null); setFeedback(''); setPreview(null); }}>新しく作る</Discover> : !['error', 'stopped'].includes(record.status) ? <button className="stop" disabled={pending} onClick={() => void act('stop')}>止める</button> : null}</footer>
 {waiting && !edge && <button className="edge-tab" onClick={() => setEdge(true)}>{designLabel}を確認</button>}
 {waiting && edge && !drawer && <aside className="design-drawer" role="region" aria-label={designLabel + 'の確認'}><div className="drawer-header"><h2>{designLabel}の確認</h2><button aria-label={designLabel + 'を畳む'} onClick={() => setEdge(false)}>×</button></div><div className="design-body"><p className="hint">{minutes ? '事実・数値・決定・宿題・相手の発言' : '見出しの縦読み・ページごとの型'}</p><pre className="design-text">{record.design}</pre>{!minutes && <details><summary>数字台帳・残った質問</summary><pre>{record.design.split(/数字台帳|残った質問/).slice(1).join('\n') || '設計図に記載されています'}</pre></details>}{!minutes && record.paletteCandidates && <section><h3>配色を見比べる</h3><iframe title="配色の比較" sandbox="" src={fileURL('palette-comparison.html', true)}/><div className="candidate-options">{record.paletteCandidates.map(id => { const p = boot?.palettes.find(p => p.id === id); return <button key={id} aria-pressed={(candidate || record.chosenPalette) === id} className={(candidate || record.chosenPalette) === id ? 'on' : ''} onClick={() => setCandidate(id)}>{id} {p?.name}<span className="color-bar">{p?.colors.map(c => <i key={c} style={{ background: c }}/>)}</span></button>; })}</div></section>}</div><input aria-label={designLabel + 'の直し指示'} placeholder={minutes ? '直し指示（任意）例：宿題の担当を確認' : '直し指示（任意）例：3枚目は2案の比較に'} value={feedback} onChange={e => setFeedback(e.target.value)}/><div className="design-actions"><button disabled={pending || !feedback.trim()} onClick={() => void act('design-revise', { feedback })}>直してもらう</button><span className="spacer"/><Discover disabled={pending} onClick={() => void act('approve', { palette: candidate || record.chosenPalette })}>OKで本番へ</Discover></div><p className="hint right">OK後の目安 {rangeText(estimate(record.input, '詳細', 'production', boot?.history, boot?.settings || defaults))}</p></aside>}
 {drawer && <><div className="backdrop" onClick={() => setDrawer(null)}/><aside className={'drawer ' + (drawer === 'history' ? 'history-drawer' : '')} role="dialog" aria-modal="true" aria-label={drawer === 'history' ? '履歴' : drawer === 'ai' ? 'この依頼のAI' : '設定'} ref={drawerRef}><div className="drawer-header"><h2>{drawer === 'history' ? '履歴' : drawer === 'ai' ? 'この依頼のAI' : '設定'}</h2><button aria-label="パネルを閉じる" onClick={() => setDrawer(null)}>×</button></div>{drawer === 'history' ? <div className="history-list">{records.length ? records.map(r => <button key={r.id} onClick={() => { setRecord(r); setInput(historyInput(r.input)); setDrawer(null); setEdge(true); setCandidate(''); }}><strong>{r.title}</strong><small>{r.fake ? '偽AI · ' : ''}{new Date(r.created).toLocaleString('ja-JP')} · {r.selectedLevel || r.input.level} · {isMinutes(r.input) ? '議事録 · Markdown＋PDF' : r.input.purpose + ' · ' + r.input.formats.join('+')}</small><span>{{ running: '生成中', question: '質問', design: '確認待ち', done: '完了', error: 'エラー', stopped: '停止' }[r.status]}</span></button>) : <p className="hint">まだ履歴はありません。最初の資料を作成してください。</p>}</div> : <><p className="hint">{drawer === 'ai' ? 'この依頼だけ変更します' : '設定はこのPCの workspace/settings.json に保存します'}</p><label>作るAI<select aria-label="作るAI" value={settingsDraft.provider} onChange={e => { const provider = e.target.value as Provider; setSettingsDraft(s => ({ ...s, provider, model: s.models[provider][0], depth: 'auto' })); }}>{(['claude', 'codex'] as const).map(p => <option key={p} value={p} disabled={!boot?.cli[p].usable}>{label(p)}{!boot?.cli[p].usable ? '（利用不可）' : ''}</option>)}</select></label><button onClick={() => void operation(async () => { await load(true); })} disabled={pending}>CLIを再確認</button><label>モデル<select aria-label="モデル" value={settingsDraft.model} onChange={e => setSettingsDraft(s => ({ ...s, model: e.target.value }))}>{allowedModels(settingsDraft, settingsDraft.provider).map(m => <option key={m}>{m}</option>)}</select></label><label>考える深さ<select aria-label="考える深さ" value={settingsDraft.depth} onChange={e => setSettingsDraft(s => ({ ...s, depth: e.target.value as Settings['depth'] }))}><option value="auto">レベルで自動（簡易 medium／詳細 high）</option>{allowedDepths(settingsDraft, settingsDraft.provider).map(d => <option key={d}>{d}</option>)}</select></label>{drawer === 'settings' && <details className="quality-settings"><summary>品質の下限</summary>{(['claude', 'codex'] as const).map(p => <label key={p}>{label(p)} の下限<select aria-label={label(p) + ' の下限'} value={settingsDraft.minimum[p]} onChange={e => { const minimum = { ...settingsDraft.minimum, [p]: e.target.value }; setSettingsDraft(s => ({ ...s, minimum, depth: 'auto' })); }}>{allowedDepths(defaults, p).map(d => <option key={d}>{d}</option>)}</select></label>)}<p className="hint">レビューは Codex の別起動、深さ high 以上です。</p></details>}<div className="spacer"/><button className="primary" disabled={pending || !boot?.cli[settingsDraft.provider].usable} onClick={() => void operation(async () => {
                    if (drawer === 'settings') {
                        const s = await post({ action: 'settings', settings: settingsDraft });
                        setBoot(b => b ? { ...b, settings: s } : b);
                        if (!active)
                            patch({ ai: { provider: s.provider, model: s.model, depth: s.depth } });
                        setNotice('設定を保存しました');
                    }
                    else
                        patch({ ai: { provider: settingsDraft.provider, model: settingsDraft.model, depth: settingsDraft.depth } });
                    setDrawer(null);
                })}>{drawer === 'ai' ? 'この依頼に使う' : '保存する'}</button></>}</aside></>}
 </main>;
}
