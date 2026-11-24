// A literal avoids compiler helper references in code sent to a sandboxed frame.
const previewTools = String.raw`(function(mode) {
    let active = null;
    let before = '';
    const elements = () => [...document.querySelectorAll('body *')].filter(el => !el.children.length && !el.closest('script,style,svg,canvas,textarea,input,select'));
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
            const section = target.closest('section');
            const kind = target.closest('h1,h2,h3,h4,h5,h6') ? '見出し' : target.closest('table') ? '表' : target.closest('svg,img,canvas,figure') ? '図' : '本文';
            const text = (target.textContent || target.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
            parent.postMessage({ type: 'neo-pick', page: pageOf(section || target), kind, text }, '*');
            return;
        }
        if (!(target instanceof HTMLElement) || target.children.length || !elements().includes(target) || !(target.textContent || '').trim() || (target.textContent || '').length > 2000) return;
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
    const script = '<script data-neo-preview-tools>(' + previewTools + ')(' + JSON.stringify(mode) + ');</script>';
    return /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, script + '$&') : html + script;
}
