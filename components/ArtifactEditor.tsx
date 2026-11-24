'use client';
import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from 'react';
import type { RecordData } from '../lib/domain';
interface Edit { before: string; after: string; page: string; index: number }
interface Props {
    src: string; html: boolean; page: string; pending: boolean; children: ReactNode;
    onPick: (location: string) => void;
    onSave: (edits: Edit[]) => Promise<{ record: RecordData; results: { saved: boolean; reason: string }[] }>;
    onDirty: (dirty: boolean) => void;
}
export default function ArtifactEditor({ src, html, page, pending, children, onPick, onSave, onDirty }: Props) {
    const [mode, setMode] = useState<'pick' | 'edit' | null>(null);
    const [edits, setEdits] = useState<Edit[]>([]);
    const editsRef = useRef<Edit[]>([]);
    const [message, setMessage] = useState('');
    const [saving, setSaving] = useState(false);
    const [reload, setReload] = useState(0);
    const iframe = useRef<HTMLIFrameElement>(null);
    const frame = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);
    const flush = useRef<(() => void) | null>(null);
    const changed = (next: Edit[]) => { editsRef.current = next; setEdits(next); };
    useEffect(() => { onDirty(mode === 'edit' || edits.length > 0 || saving); }, [mode, edits.length, saving, onDirty]);
    useEffect(() => () => onDirty(false), [onDirty]);
    useEffect(() => {
        if (!mode || !frame.current) return;
        const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1920));
        observer.observe(frame.current);
        return () => observer.disconnect();
    }, [mode]);
    useEffect(() => {
        if (!mode) return;
        const handle = (event: MessageEvent) => {
            if (!iframe.current || event.source !== iframe.current.contentWindow) return;
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            if (data.type === 'neo-flushed') { flush.current?.(); return; }
            // ページ名は表示に使うだけなので、制御文字と括弧だけ除いて受け取る（「1・表紙」「2/10」なども可）
            if (typeof data.page !== 'string' || data.page.length > 40) return;
            data.page = data.page.replace(/[\u0000-\u001f\u007f［］<>]/g, ' ').trim() || '?';
            if (mode === 'pick' && data.type === 'neo-pick' && ['見出し', '本文', '表', '図'].includes(data.kind) && typeof data.text === 'string' && data.text.length <= 2000) {
                onPick('［場所：P' + data.page + '・' + data.kind + '「' + data.text.slice(0, 40).replace(/[\r\n［］]/g, ' ') + '」］');
            }
            if (mode === 'edit' && data.type === 'neo-edit' && typeof data.before === 'string' && data.before.trim() && data.before.length <= 2000 && typeof data.after === 'string' && data.after.length <= 2000 && Number.isSafeInteger(data.index) && data.index >= 0) {
                const next = [...editsRef.current];
                const at = next.findIndex(edit => edit.page === data.page && edit.index === data.index && edit.after === data.before);
                if (at >= 0) next[at] = { ...next[at], after: data.after };
                else if (next.length < 100) next.push({ before: data.before, after: data.after, page: data.page, index: data.index });
                changed(next.filter(edit => edit.before !== edit.after));
            }
        };
        window.addEventListener('message', handle);
        return () => window.removeEventListener('message', handle);
    }, [mode, onPick]);
    useEffect(() => {
        if (!edits.length) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [edits.length]);
    const save = async () => {
        setSaving(true); setMessage('');
        try {
            // Commit a still-focused field before reading the edit list.
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => { flush.current = null; reject(Error('編集内容を受け取れませんでした。もう一度保存してください')); }, 3000);
                flush.current = () => { clearTimeout(timer); flush.current = null; resolve(); };
                iframe.current?.contentWindow?.postMessage({ type: 'neo-flush' }, '*');
            });
            if (!editsRef.current.length) { setMessage('保存する変更はありません'); return; }
            const result = await onSave(editsRef.current);
            const failed = result.results.filter(item => !item.saved);
            setMessage('保存 ' + result.results.filter(item => item.saved).length + '件' + (failed.length ? '／' + failed.length + '件 ' + failed[0].reason : ' · AIは使っていません'));
            changed(editsRef.current.filter((_, index) => !result.results[index].saved));
            if (!failed.length) setMode(null);
            setReload(value => value + 1);
        } catch (error) { setMessage(String(error)); }
        finally { setSaving(false); }
    };
    const imagePick = (event: MouseEvent<HTMLImageElement>) => {
        if (mode !== 'pick') return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = Math.round((event.clientX - rect.left) / rect.width * 100), y = Math.round((event.clientY - rect.top) / rect.height * 100);
        const position = (x < 33 ? '左' : x > 67 ? '右' : '') + (y < 33 ? '上' : y > 67 ? '下' : '中央');
        onPick('［場所：P' + page.replace(/\D/g, '') + '・' + position + '付近（横' + x + '%・縦' + y + '%）］');
    };
    const locked = pending || saving;
    return <div className="artifact-editor">
        <div className="artifact-edit-toolbar" role="group" aria-label="プレビューの直し方">
            <button aria-pressed={mode === 'pick'} disabled={locked || !src || edits.length > 0} onClick={() => { setMode(mode === 'pick' ? null : 'pick'); setMessage(''); }}>場所を選ぶ</button>
            {html ? <button aria-pressed={mode === 'edit'} disabled={locked || edits.length > 0} onClick={() => { setMode(mode === 'edit' ? null : 'edit'); setMessage(''); }}>文字を直す</button> : <span className="hint">文字はPowerPointで開いて直してください</span>}
            {mode === 'edit' && <><button disabled={locked} onClick={() => void save()}>文字の変更を保存</button><button disabled={locked} onClick={() => { changed([]); setReload(value => value + 1); setMode(null); setMessage('変更を取り消しました'); }}>取り消し</button><span className="hint">未保存 {edits.length}件 · AI不使用</span></>}
        </div>
        {mode && <p className="hint">{mode === 'pick' ? '点線で囲まれた所が選べます。押すとAIへの指示欄に場所が入るので、その下にどう直したいかを書いて「直しを送る」を押してください。複数選べます。' : '点線で囲まれた文字だけ直せます（グラフの数値などJSが描いた文字や、同じ文字が何か所もある所は直せないので「場所を選ぶ」でAIに頼んでください）。押して書き換え、Enterで確定し、最後に「文字の変更を保存」を押してください。'}</p>}
        {mode ? <div className="artifact-edit-stage"><div className="artifact-edit-frame" ref={frame} aria-busy={saving}>
            {html ? <iframe ref={iframe} key={src + mode + reload} title="直す場所のプレビュー" sandbox="allow-scripts" src={src + '&' + mode + '=1&v=' + reload} style={{ transform: 'scale(' + scale + ')' }}/>
                : <img alt={page + '・直す場所を選ぶ'} src={src} onClick={imagePick}/>}
        </div></div> : children}
        {edits.length > 0 && <details className="artifact-edit-list"><summary>未保存の文字 {edits.length}件</summary><ul>{edits.map((edit, index) => <li key={index}>P{edit.page}：{edit.before} → {edit.after || '（空欄）'}</li>)}</ul></details>}
        {message && <p role="status" className="artifact-edit-message">{message}</p>}
    </div>;
}
