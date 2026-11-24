import { editableTexts } from './text-edit';
// A literal avoids compiler helper references in code sent to a sandboxed frame.
const previewTools = String.raw`(function(mode, editable) {
    let active = null;
    let before = '';
    const elements = () => [...document.querySelectorAll('body *')].filter(el => !el.children.length && !el.closest('script,style,svg,canvas,textarea,input,select'));
    // 選べる・直せる所に印を付ける（点線。カーソルを合わせると濃い枠と色）。印の無い所は押しても何も起きない
    const pickSelector = 'h1,h2,h3,h4,h5,h6,p,li,th,td,figcaption,blockquote,[data-claim],svg,img,canvas';
    const editableSet = new Set(editable || []);
    const canEdit = el => el instanceof HTMLElement && elements().includes(el) && editableSet.has((el.textContent || '').trim());
    const pickTarget = el => {
        const hit = el.closest(pickSelector);
        if (hit) return hit.closest('svg') || hit;
        // 見出し・段落の要素でなくても、文字だけを持つ要素（div・span）は選べる
        return el instanceof HTMLElement && !el.children.length && (el.textContent || '').trim() && !el.closest('script,style') ? el : null;
    };
    const style = document.createElement('style');
    style.textContent = '.neo-spot{outline:2px dashed rgba(34,89,102,.55)!important;outline-offset:2px;cursor:pointer!important}' +
        '.neo-spot:hover{outline:3px solid #225966!important;background-color:rgba(116,211,216,.22)!important}' +
        'body.neo-picking *:not(.neo-spot),body.neo-editing *:not(.neo-spot){cursor:default}';
    document.head.appendChild(style);
    document.body.classList.add(mode === 'pick' ? 'neo-picking' : 'neo-editing');
    const mark = () => {
        for (const el of document.querySelectorAll('body *')) {
            if (el.closest('script,style') || el === document.body) continue;
            const on = mode === 'pick' ? pickTarget(el) === el : canEdit(el);
            if (on !== el.classList.contains('neo-spot')) el.classList.toggle('neo-spot', on);
        }
    };
    mark();
    // 動く版はJSで図を描き直すので、変化したら印を付け直す
    let timer = 0;
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(mark, 150); }).observe(document.body, { childList: true, subtree: true, characterData: true });
    const pageOf = (el) => {
        const section = el.closest('section[data-page],section');
        return (section?.getAttribute('data-page') || String(section ? [...document.querySelectorAll('section')].indexOf(section) + 1 : 1)).slice(0, 40);
    };
    const commit = () => {
        if (!active) return;
        const el = active;
        active = null;
        const after = el.textContent || '';
        el.removeAttribute('contenteditable');
        el.style.outline = '';
        if (after !== before) {
            // 書き換えたばかりの文字も、続けて直せるように印を残す（保存時は元の文字からまとめて置き換える）
            if (after.length <= 2000) editableSet.add(after.trim());
            if (after.length <= 2000) parent.postMessage({ type: 'neo-edit', before, after, page: pageOf(el), index: elements().indexOf(el) }, '*');
            else el.textContent = before;
        }
    };
    // ページ送り（前へ・次へ）だけは資料の動きを通し、2ページ目以降も選べるようにする
    const navSelector = '#next,#prev,.next,.prev,[data-nav],[aria-label*="次"],[aria-label*="前"],[aria-label*="ページ"]';
    const isNav = (event) => event.target instanceof Element && !!event.target.closest(navSelector);
    window.addEventListener('click', event => {
        if (!active && isNav(event)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        if (mode === 'pick') {
            const spot = pickTarget(target);
            if (!spot) return;
            const section = spot.closest('section');
            const kind = spot.closest('h1,h2,h3,h4,h5,h6') ? '見出し' : spot.closest('table') ? '表' : spot.closest('svg,img,canvas,figure') ? '図' : '本文';
            const text = (spot.textContent || spot.getAttribute('alt') || spot.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
            parent.postMessage({ type: 'neo-pick', page: pageOf(section || spot), kind, text }, '*');
            return;
        }
        // 直せる印（保存すると書き換えられる文字）の付いた所だけ編集できる
        if (!canEdit(target) || (target.textContent || '').length > 2000) return;
        if (active === target) return;
        commit();
        active = target; before = target.textContent || '';
        target.contentEditable = 'plaintext-only';
        target.style.outline = '3px solid #225966'; target.focus();
    }, true);
    // Block document interactions while allowing the browser's native text selection.
    for (const type of ['pointerdown', 'mousedown', 'dblclick', 'submit']) document.addEventListener(type, event => { if (!active && type !== 'submit' && isNav(event)) return; event.stopImmediatePropagation(); if (type === 'submit') event.preventDefault(); }, true);
    const navKeys = ['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp', ' ', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    window.addEventListener('keydown', event => {
        // 書き換え中でない時は、ページ送りのキーを資料へ通す
        if (!active && navKeys.includes(event.key)) return;
        event.stopImmediatePropagation();
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); commit(); }
        if (event.key === 'Escape' && active) { active.textContent = before; commit(); }
    }, true);
    document.addEventListener('focusout', commit, true);
    window.addEventListener('message', event => {
        if (event.source !== parent || event.data?.type !== 'neo-flush') return;
        commit();
        parent.postMessage({ type: 'neo-flushed' }, '*');
    });
})`;
export function injectPreviewTools(html: string, url: URL) {
    if (url.searchParams.get('preview') !== '1') return html;
    const mode = url.searchParams.get('edit') === '1' ? 'edit' : url.searchParams.get('pick') === '1' ? 'pick' : null;
    if (!mode) return html;
    // 文字を直す時は、保存して書き換えられる文字の一覧を渡し、その文字にだけ印を付ける。
    // script の中に置くので、< を < にして </script> で途切れないようにする
    const editable = mode === 'edit' ? editableTexts(html) : [];
    const script = '<script data-neo-preview-tools>(' + previewTools + ')(' + JSON.stringify(mode) + ',' + JSON.stringify(editable).replace(/</g, '\\u003c') + ');</script>';
    return /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, script + '$&') : html + script;
}
