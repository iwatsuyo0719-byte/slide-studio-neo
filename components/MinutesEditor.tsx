'use client';
import { useEffect, useState } from 'react';
import { markdownToHTML } from '../lib/markdown';

export default function MinutesEditor({ markdown, pending, onSave, onDirtyChange }: {
    markdown: string;
    pending: boolean;
    onSave: (minutes: string) => void;
    onDirtyChange: (dirty: boolean) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(markdown);
    useEffect(() => { onDirtyChange(draft !== markdown); return () => onDirtyChange(false); }, [draft, markdown, onDirtyChange]);
    let html: string | undefined;
    try { if (!editing) html = markdownToHTML(markdown); } catch { /* Keep editing available even if rendering fails. */ }
    return <div className="minutes-editor" aria-busy={pending}>
        <div className="minutes-toolbar">
            <div className="segments" aria-label="議事録の表示方法">
                <button aria-pressed={!editing} className={!editing ? 'on' : ''} disabled={pending} onClick={() => setEditing(false)}>表示</button>
                <button aria-pressed={editing} className={editing ? 'on' : ''} disabled={pending} onClick={() => setEditing(true)}>編集</button>
            </div>
            {draft !== markdown && <span className="hint">未保存の変更があります</span>}
        </div>
        {editing ? <>
            <textarea className="minutes-source" aria-label="議事録のMarkdown" maxLength={500000} value={draft} disabled={pending} onChange={e => setDraft(e.target.value)}/>
            <button className="primary" disabled={pending} onClick={() => onSave(draft)}>{pending ? '保存中…' : '保存してPDFを作り直す'}</button>
        </> : html === undefined ? <pre className="minutes-document" aria-label="議事録の本文">{markdown}</pre> : <article className="minutes-document" aria-label="議事録の本文" dangerouslySetInnerHTML={{ __html: html }}/> }</div>;
}
