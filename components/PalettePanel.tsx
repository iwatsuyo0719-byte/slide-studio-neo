'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Palette } from '../lib/domain';
type Ticker = {
    add: (fn: (time: number, delta: number) => void) => void;
    remove: (fn: (time: number, delta: number) => void) => void;
};
declare global {
    interface Window {
        gsap?: {
            ticker: Ticker;
        };
    }
}
export default function PalettePanel({ palettes, value, brand, onChange, onBrand, disabled, unavailableReason }: {
    palettes: Palette[];
    value: string;
    brand: string;
    onChange: (id: string) => void;
    onBrand: (s: string) => void;
    disabled: boolean;
    unavailableReason?: string;
}) {
    const [group, setGroup] = useState('すべて');
    const [preview, setPreview] = useState<{ p?: Palette; id: string; name: string; anchor: HTMLButtonElement } | null>(null);
    const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const popup = useRef<HTMLDivElement>(null);
    const containsTarget = (element: HTMLElement | null, target: EventTarget | null) => target instanceof Node && !!element?.contains(target);
    const hidePreview = () => { clearTimeout(previewTimer.current); setPreview(null); };
    const showPreview = (anchor: HTMLButtonElement, p: Palette | undefined, id: string, name: string) => {
        hidePreview();
        if (disabled || drag.current.down || drag.current.moved) return;
        const show = () => {
            if (!drag.current.down && !drag.current.moved && anchor.isConnected)
                setPreview({ p, id, name, anchor });
        };
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) show();
        else previewTimer.current = setTimeout(show, 150);
    };
    const description = (id: string) => id === 'auto' ? '素材に合う配色をAIが選びます。詳細版では3組から選べます' : 'ブランド色を6桁のHEXで指定します';
    const viewport = useRef<HTMLDivElement>(null);
    const track = useRef<HTMLDivElement>(null);
    const drag = useRef({ down: false, x: 0, start: 0, last: 0, velocity: 0, moved: false, hover: false, focus: false });
    const filtered = palettes.filter(p => group === 'すべて' || p.group === group);
    const selected = palettes.find(p => p.id === value);
    const groups = [...new Set(palettes.map(p => p.group))];
    // 位置は小数で持ち、transform で動かす（scrollLeft は整数に丸められて、ゆっくり動かすとカクつくため）
    const motion = useRef({ pos: 0, speed: 0, reduced: false });
    const BASE_SPEED = 22; // px/秒。ゆっくり流す
    useEffect(() => {
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') hidePreview(); };
        document.addEventListener('keydown', escape);
        return () => { clearTimeout(previewTimer.current); document.removeEventListener('keydown', escape); };
    }, []);
    useEffect(() => {
        if (!preview || disabled) return;
        let raf = 0;
        const position = () => {
            const node = popup.current;
            if (!node) return;
            const rect = preview.anchor.getBoundingClientRect();
            const width = node.offsetWidth;
            node.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, rect.left + (rect.width - width) / 2))}px`;
            node.style.top = `${Math.max(12, rect.top - node.offsetHeight + 2)}px`;
            raf = requestAnimationFrame(position);
        };
        position();
        return () => { cancelAnimationFrame(raf); };
    }, [preview, disabled]);
    const place = () => {
        const tr = track.current;
        if (!tr) return;
        const m = motion.current;
        if (m.reduced) { tr.style.transform = ''; return; }
        const half = tr.scrollWidth / 2;
        if (half > 0) m.pos = ((m.pos % half) + half) % half;
        tr.style.transform = `translate3d(${-m.pos}px,0,0)`;
    };
    useEffect(() => {
        hidePreview();
        const box = viewport.current, tr = track.current;
        if (!box || !tr)
            return;
        box.scrollLeft = 0;
        const m = motion.current;
        m.pos = 0;
        const reduce = matchMedia('(prefers-reduced-motion: reduce)');
        m.reduced = reduce.matches;
        box.classList.toggle('free-scroll', m.reduced);
        place();
        const media = () => { m.reduced = reduce.matches; drag.current.velocity = 0; box.classList.toggle('free-scroll', m.reduced); place(); };
        reduce.addEventListener('change', media);
        let alive = true, raf = 0, last = 0, ticker: Ticker | undefined;
        const step = (delta: number) => {
            if (!alive || m.reduced || disabled)
                return;
            const d = drag.current;
            if (d.down) { m.speed = 0; return; }
            const dt = Math.min(delta, 50) / 1000;
            // 慣性：ドラッグを離した時の速さから、なめらかに減速
            if (Math.abs(d.velocity) > 1) {
                m.pos += d.velocity * dt;
                d.velocity *= Math.exp(-dt / 0.45);
                m.speed = d.velocity;
            } else {
                d.velocity = 0;
                // ホバー・フォーカス中は止め、離れたらゆっくり加速して元の速さに戻る
                const target = d.hover || d.focus ? 0 : BASE_SPEED;
                m.speed += (target - m.speed) * Math.min(1, dt / 0.8);
                m.pos += m.speed * dt;
            }
            place();
        };
        const tick = (_time: number, deltaMs = 16.7) => step(deltaMs);
        const frame = (time: number) => { step(last ? time - last : 16.7); last = time; raf = requestAnimationFrame(frame); };
        const attach = () => {
            if (!alive)
                return;
            if (window.gsap) {
                ticker = window.gsap.ticker;
                ticker.add(tick);
            }
            else
                raf = requestAnimationFrame(frame);
        };
        if (window.gsap)
            attach();
        else {
            const script = document.createElement('script');
            script.src = '/api/motion';
            script.onload = attach;
            script.onerror = attach;
            document.head.appendChild(script);
        }
        return () => { clearTimeout(previewTimer.current); alive = false; cancelAnimationFrame(raf); ticker?.remove(tick); reduce.removeEventListener('change', media); };
    }, [group, disabled]);
    const card = (p: Palette | undefined, id: string, name: string, clone = false) => <button key={id} type="button" className={'palette-card ' + (value === id ? 'selected' : '')} aria-pressed={value === id} tabIndex={clone || disabled ? -1 : 0} disabled={disabled}
        onMouseEnter={e => showPreview(e.currentTarget, p, id, name)}
        onMouseLeave={e => { if (!containsTarget(popup.current, e.relatedTarget)) hidePreview(); }}
        onFocus={e => {
            drag.current.focus = true;
            if (motion.current.reduced) e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            else {
                const box = viewport.current;
                if (box) {
                    const b = box.getBoundingClientRect(), c = e.currentTarget.getBoundingClientRect();
                    if (c.left < b.left) motion.current.pos -= b.left - c.left + 8;
                    else if (c.right > b.right) motion.current.pos += c.right - b.right + 8;
                    place();
                }
            }
            showPreview(e.currentTarget, p, id, name);
        }}
        onBlur={() => { drag.current.focus = false; hidePreview(); }}
        onClick={() => { if (!drag.current.moved) onChange(id); }}
        aria-label={p ? `${id} ${name}。${p.mood}。${p.group}。${p.colors.join('、')}` : `${name}。${description(id)}`}
        title={disabled ? undefined : p ? `${id} ${name}：${p.mood}（${p.group}） ${p.colors.join(' ')}` : `${name}：${description(id)}`}
        data-palette={clone ? undefined : id}><span className="color-bar">{p ? p.colors.map(c => <i key={c} style={{ background: c }}/>) : <span>{id === 'auto' ? '✦' : '#______'}</span>}</span><small>{id === 'auto' ? 'AUTO' : id === 'brand' ? 'HEX' : id}</small><span>{name}</span></button>;
    return <section className={'palette-panel ' + (disabled ? 'locked' : '')} aria-label="配色" aria-disabled={disabled}><div className="palette-head"><h2><b className="number">6</b>配色 <small>{unavailableReason || 'ドラッグで流せます'}</small></h2><div className="palette-tabs" aria-label="配色の系統">{['すべて', ...groups].map(g => <button key={g} className={g === group ? 'on' : ''} aria-pressed={g === group} disabled={disabled} onClick={() => setGroup(g)}>{g}</button>)}</div><span className="spacer"/><span className="hint selection">選択中：{selected ? selected.id + ' ' + selected.name : value === 'auto' ? 'おまかせ' : 'ブランド色'}</span></div>
 <div className="marquee" ref={viewport} tabIndex={disabled ? -1 : 0} role="region" aria-label="配色パネル。ドラッグか左右キーで動かせます" onFocus={() => { drag.current.focus = true; }} onBlur={e => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
                drag.current.focus = false;
        }} onMouseEnter={() => { drag.current.hover = true; }} onMouseLeave={e => { if (!containsTarget(popup.current, e.relatedTarget)) { drag.current.hover = false; hidePreview(); } }} onPointerDown={e => {
            if (disabled)
                return;
            hidePreview();
            const d = drag.current;
            d.down = true;
            d.moved = false;
            d.start = e.clientX;
            d.x = e.clientX;
            d.last = performance.now();
            d.velocity = 0;
        }} onPointerMove={e => {
            const d = drag.current;
            if (!d.down || !viewport.current)
                return;
            const dx = e.clientX - d.x;
            d.moved = d.moved || Math.abs(e.clientX - d.start) > 5;
            if (d.moved) {
                viewport.current.setPointerCapture(e.pointerId);
                e.preventDefault();
            }
            if (motion.current.reduced) viewport.current.scrollLeft -= dx;
            else { motion.current.pos -= dx; place(); }
            d.velocity = -dx * 1000 / Math.max(8, performance.now() - d.last); // px/秒
            d.last = performance.now();
            d.x = e.clientX;
        }} onPointerUp={e => {
            const d = drag.current;
            d.down = false;
            if (viewport.current?.hasPointerCapture(e.pointerId))
                viewport.current.releasePointerCapture(e.pointerId);
            setTimeout(() => { d.moved = false; }, 0);
        }} onPointerCancel={() => drag.current.down = false} onKeyDown={e => {
            if (['ArrowLeft', 'ArrowRight'].includes(e.key) && viewport.current) {
                e.preventDefault();
                drag.current.velocity = 0;
                const buttons = Array.from(track.current?.querySelectorAll<HTMLButtonElement>('[data-palette]') || []);
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                if (index >= 0) {
                    buttons[(index + (e.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
                    return;
                }
                hidePreview();
                const dist = e.key === 'ArrowLeft' ? -244 : 244;
                if (motion.current.reduced) viewport.current.scrollLeft += dist;
                else { motion.current.pos += dist; place(); }
            }
        }}>
 <div className="palette-track" ref={track}>{[false, true].map(clone => <div className="palette-group" key={String(clone)} aria-hidden={clone || undefined} inert={clone || undefined}>{card(undefined, 'auto', 'おまかせ', clone)}{filtered.map(p => card(p, p.id, p.name, clone))}{card(undefined, 'brand', 'ブランド色', clone)}</div>)}</div></div>
 <div className="selected-colors">{selected?.colors.map(c => <span key={c} style={{ background: c }} title={c}><span>{c}</span></span>)}{value === 'auto' && <span className="hint">素材に合う配色をAIが選びます。詳細版では3組から選べます</span>}{value === 'brand' && <label>ブランド色 <input aria-label="ブランド色HEX" value={brand} onChange={e => onBrand(e.target.value)} placeholder="#225966" maxLength={7} disabled={disabled}/><small># と6桁のHEX</small></label>}</div>
 {preview && !disabled && createPortal(<div ref={popup} className="palette-popup" aria-hidden="true"
     onMouseLeave={e => { hidePreview(); drag.current.hover = containsTarget(viewport.current, e.relatedTarget); }}
     onMouseDown={e => e.preventDefault()}
     onClick={() => { if (!disabled && !drag.current.down && !drag.current.moved) onChange(preview.id); }}>
     {preview.p && <><div className="palette-popup-colors">{preview.p.colors.map(c => <i key={c} style={{ background: c }}/>)}</div><div className="palette-popup-codes">{preview.p.colors.map(c => <span key={c}>{c.toUpperCase()}</span>)}</div></>}
     <div className="palette-popup-copy"><strong>{preview.p ? `${preview.id} ${preview.name}` : preview.name}</strong><p>{preview.p?.mood || description(preview.id)}</p>{preview.p && <small>{preview.p.group}</small>}</div>
 </div>, document.body)}</section>;
}
