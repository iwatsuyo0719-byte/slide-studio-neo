'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
    src: string;
    html: boolean;
    page: number;
    total: number;
    label: string;
    onClose: () => void;
    onMove: (direction: number) => void;
    icon: (name: string) => ReactNode;
    children: ReactNode;
}

export default function PreviewDialog({ src, html, page, total, label, onClose, onMove, icon, children }: Props) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const frameRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);
    const moveRef = useRef(onMove);
    moveRef.current = onMove;
    useEffect(() => {
        const dialog = dialogRef.current!;
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        dialog.showModal();
        const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1920));
        observer.observe(frameRef.current!);
        // ←→ はフォーカスがどこにあっても受ける（入力欄で文字を打っている時は除く）
        const onKey = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.altKey || e.ctrlKey || e.metaKey) return;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                moveRef.current(e.key === 'ArrowLeft' ? -1 : 1);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            observer.disconnect();
            dialog.close();
            document.body.style.overflow = overflow;
            if (opener?.isConnected) opener.focus();
        };
    }, []);
    return <dialog ref={dialogRef} className="preview-dialog" role="dialog" aria-modal="true" aria-label="成果物の拡大プレビュー"
        onCancel={e => { e.preventDefault(); onClose(); }}
        onKeyDown={e => {
            if (e.key === 'Tab') {
                const controls = dialogRef.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href]');
                const first = controls[0], last = controls[controls.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }}>
        <div className="preview-dialog-header"><h2>大きく見る</h2><span className="spacer"/><button autoFocus aria-label="拡大プレビューを閉じる" onClick={onClose}>{icon('close')}</button></div>
        <div className="preview-dialog-stage"><div className="preview-dialog-frame" ref={frameRef}>
            {html ? <iframe key={src} title="成果物の拡大プレビュー" sandbox="allow-scripts" tabIndex={-1} src={src} style={{ transform: `scale(${scale})` }}/>
                : <img alt={label + 'の拡大プレビュー'} src={src}/>}
        </div></div>
        <nav className="preview-dialog-navigation" aria-label="プレビューのページ送り">
            <button aria-label="前のページ" disabled={page === 0} onClick={() => onMove(-1)}>{icon('chevron_left')}</button>
            <span aria-live="polite">{page + 1} / {total} · {label}</span>
            <button aria-label="次のページ" disabled={page === total - 1} onClick={() => onMove(1)}>{icon('chevron_right')}</button>
        </nav>
        <div className="preview-dialog-footer">{children}</div>
    </dialog>;
}
