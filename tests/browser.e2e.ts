import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const base = process.env.NEO_TEST_URL || 'http://127.0.0.1:3210';
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
test('1280×720のTOPから偽AI生成、設計図、完了、履歴、設定まで通す', { timeout: 180000 }, async () => {
    const bootstrap = await fetch(base + '/api/neo').then(r => r.json());
    assert.equal(bootstrap.fake, true, '実AIでは実行しません');
    const profile = path.resolve('test-results/browser-test-' + crypto.randomUUID());
    await fs.mkdir(profile, { recursive: true });
    const child = spawn(chrome, [...(process.env.NEO_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), '--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--window-size=1280,720', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', d => stderr += d);
    let ws: WebSocket | undefined;
    const errors: string[] = [];
    let session = '';
    try {
        for (let n = 0; n < 200 && !/DevTools listening on (ws:\/\/[^\s]+)/.test(stderr); n++) {
            if (child.exitCode !== null)
                throw Error('Chromeが終了しました：' + stderr);
            await delay(50);
        }
        const endpoint = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
        assert.ok(endpoint, 'DevToolsに接続できません：' + stderr);
        console.log('Chrome DevTools ready');
        ws = new WebSocket(endpoint);
        const connectionTimer = setTimeout(() => ws?.close(), 10000);
        await new Promise<void>((resolve, reject) => { ws!.addEventListener('open', () => resolve(), { once: true }); ws!.addEventListener('error', () => reject(Error('DevTools接続エラー')), { once: true }); });
        clearTimeout(connectionTimer);
        console.log('DevTools connected');
        let sequence = 0;
        const pending = new Map<number, {
            resolve: (v: any) => void;
            reject: (e: Error) => void;
        }>();
        ws.addEventListener('message', e => {
            const m = JSON.parse(String(e.data));
            if (m.method === 'Runtime.exceptionThrown' || (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'))
                errors.push(JSON.stringify(m.params));
            if (m.id) {
                const p = pending.get(m.id);
                pending.delete(m.id);
                if (m.error)
                    p?.reject(Error(JSON.stringify(m.error)));
                else
                    p?.resolve(m.result);
            }
        });
        const send = (method: string, params: unknown = {}, target = true) => new Promise<any>((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 10000); pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } }); ws!.send(JSON.stringify({ id, method, params, ...(target && session ? { sessionId: session } : {}) })); });
        const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, false);
        session = (await send('Target.attachToTarget', { targetId, flatten: true }, false)).sessionId;
        console.log('Target attached');
        await send('Page.enable');
        await send('Runtime.enable');
        await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
        const evaluate = async (expression: string) => {
            const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (r.exceptionDetails)
                throw Error(JSON.stringify(r.exceptionDetails));
            return r.result.value;
        };
        const wait = async (expression: string) => {
            for (let n = 0; n < 400; n++) {
                if (await evaluate('!!(' + expression + ')'))
                    return;
                await delay(50);
            }
            throw Error('画面の待機がタイムアウト：' + expression);
        };
        const label = "const label=b=>{const c=b.cloneNode(true);c.querySelectorAll('[aria-hidden=true]').forEach(e=>e.remove());return c.textContent.trim();};";
        const click = async (text: string) => evaluate("(()=>{" + label + "const b=[...document.querySelectorAll('button')].find(b=>label(b)===" + JSON.stringify(text) + ");if(!b)throw Error('button missing: '+" + JSON.stringify(text) + ");b.click();})()");
        const material = async (value: string) => evaluate("(()=>{const el=document.querySelector('#material');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el," + JSON.stringify(value) + ");el.dispatchEvent(new Event('input',{bubbles:true}));})()");
        console.log('Navigating to app');
        await send('Page.navigate', { url: base });
        await wait("document.querySelector('.status-line')?.textContent.includes('偽AI')");
        assert.equal(await evaluate('document.documentElement.scrollHeight <= innerHeight'), true);
        assert.equal(await evaluate('document.querySelectorAll("[data-palette]").length'), 102);
        assert.equal(await evaluate('document.querySelector("[data-palette].selected").getAttribute("aria-pressed")'), 'true');
        // ホバーで拡大し、カードの配置と1画面の高さを維持する。
        const cardRect = await evaluate("(()=>{const r=document.querySelectorAll('[data-palette]')[1].getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cardRect.x + cardRect.width / 2, y: cardRect.y + cardRect.height / 2 });
        await wait("document.querySelector('.palette-popup')");
        await delay(200);
        assert.equal(await evaluate("document.querySelector('.palette-popup').offsetWidth"), 280);
        assert.equal(await evaluate("document.querySelectorAll('.palette-popup-codes span').length"), 5);
        assert.equal(await evaluate('document.documentElement.scrollHeight <= innerHeight'), true);
        assert.equal(await evaluate("Math.round(document.querySelectorAll('[data-palette]')[1].getBoundingClientRect().width)"), Math.round(cardRect.width));
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
        await wait("!document.querySelector('.palette-popup')");
        assert.equal(await evaluate("(()=>{" + label + "return [...document.querySelectorAll('button')].find(b=>label(b)==='作成する').disabled})()"), true);
        await fs.mkdir('test-results/verification', { recursive: true });
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile('test-results/verification/input-1280.png', Buffer.from(shot.data, 'base64'));
        await material('架空の週次報告です。今週は計画を確認し、来週の担当を決めます。');
        await click('html');
        await click('pptx');
        await click('詳細');
        await evaluate("document.querySelector('[data-palette=auto]').click()");
        await click('作成する');
        await wait("document.querySelector('.progress-card')");
        assert.equal(await evaluate("document.querySelector('fieldset').disabled"), true);
        await wait("document.querySelector('.design-drawer')");
        assert.equal(await evaluate('document.documentElement.scrollHeight <= innerHeight'), true);
        assert.ok(await evaluate("document.querySelector('.percent').textContent!=='100%'"));
        await evaluate("document.querySelector('[aria-label=設計図を畳む]').click()");
        await wait("document.querySelector('.edge-tab')");
        await click('設計図を確認');
        await wait("document.querySelector('.design-drawer')");
        const designShot = await send('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile('test-results/verification/design-1280.png', Buffer.from(designShot.data, 'base64'));
        // Observe the first done DOM commit, so an effect cannot hide a missing initial preview.
        await evaluate("new MutationObserver((_,observer)=>{if(!document.querySelector('.result-top'))return;if(!document.querySelector('iframe[title=成果物プレビュー]'))document.documentElement.dataset.previewMissing='true';else observer.disconnect();}).observe(document.querySelector('.right-column'),{childList:true,subtree:true})");
        await click('OKで本番へ');
        await wait("document.querySelector('.result-top')?.textContent.includes('できあがりました')");
        assert.ok(await evaluate("document.querySelector('iframe[title=成果物プレビュー]')?.getAttribute('sandbox')==='allow-scripts'"));
        assert.equal(await evaluate("document.documentElement.dataset.previewMissing || ''"), '', '完了の初回描画からsandbox付きプレビューがある');
        assert.equal(await evaluate('document.documentElement.scrollHeight <= innerHeight'), true);
        assert.ok(await evaluate("document.querySelector('.results-text').textContent.includes('Codex')"));
        const resultShot = await send('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile('test-results/verification/done-1280.png', Buffer.from(resultShot.data, 'base64'));
        await click('履歴');
        await wait("document.querySelector('.history-list button')");
        assert.ok(await evaluate("document.querySelector('.history-list').textContent.includes('完了')"));
        await evaluate("document.querySelector('[aria-label=パネルを閉じる]').click()");
        await click('新しく作る');
        await click('設定');
        await wait("document.querySelector('[aria-label=モデル]')");
        assert.equal(await evaluate("[...document.querySelector('[aria-label=モデル]').options].some(o=>/sonnet|haiku|mini/.test(o.value))"), false);
        assert.equal(await evaluate("[...document.querySelector('[aria-label=考える深さ]').options].some(o=>o.value==='low')"), false);
        await evaluate("document.querySelector('[aria-label=パネルを閉じる]').click()");
        assert.deepEqual(await evaluate("(()=>{" + label + "return [...document.querySelectorAll('.purpose-grid button')].map(label)})()"), ['提案', '報告', '説明・研修', '議事録']);
        assert.deepEqual(await evaluate("[...document.querySelectorAll('.purpose-grid .icon')].map(e=>e.textContent)"), ['adjust', 'trending_up', 'diamond', 'description']);
        await click('議事録');
        await wait("document.querySelector('.fixed-format')?.textContent==='Markdown＋PDF（固定）'");
        assert.equal(await evaluate("document.querySelector('.palette-panel').getAttribute('aria-disabled')"), 'true');
        assert.ok(await evaluate("document.querySelector('.palette-panel').textContent.includes('議事録では配色を使いません')"));
        assert.equal(await evaluate("[...document.querySelectorAll('.palette-panel button,.palette-panel input')].every(b=>b.disabled && b.tabIndex===-1)"), true);
        assert.equal(await evaluate("document.querySelector('.marquee').tabIndex"), -1);
        const lockedPalette = await evaluate("document.querySelector('[data-palette].selected').getAttribute('data-palette')");
        await evaluate("document.querySelector('[data-palette]:not(.selected)').click()");
        assert.equal(await evaluate("document.querySelector('[data-palette].selected').getAttribute('data-palette')"), lockedPalette);
        await evaluate("document.querySelector('[data-palette=auto]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))");
        await delay(250);
        assert.equal(await evaluate("!!document.querySelector('.palette-popup')"), false);
        assert.equal(await evaluate("document.querySelector('.purpose-grid button.on').disabled"), false);
        assert.ok(await evaluate("[...document.querySelectorAll('.fixed-format')].some(e=>e.textContent==='詳細・止まらず完成まで（固定）')"));
        assert.equal(await evaluate("(()=>{" + label + "return [...document.querySelectorAll('fieldset button')].some(b=>['簡易','詳細','AUTO'].includes(label(b)))})()"), false);
        assert.ok(await evaluate("document.querySelector('.ai-chip').textContent.includes('high')"));
        await material('週次会議。計画を確認することを決定した。担当と期限は未確認。');
        assert.ok(await evaluate("document.querySelector('.estimate').textContent.includes('約15〜25分')"));
        await evaluate("window.__minutesWaits=0; window.__minutesObserver=new MutationObserver(()=>{if(document.querySelector('.design-drawer,.edge-tab'))window.__minutesWaits++});window.__minutesObserver.observe(document.body,{childList:true,subtree:true})");
        await click('作成する');
        await wait("document.querySelector('.minutes-document h1')");
        assert.equal(await evaluate("window.__minutesWaits"), 0);
        await evaluate("window.__minutesObserver.disconnect()");
        assert.equal(await evaluate("!!document.querySelector('.design-drawer,.edge-tab')"), false);
        assert.ok(await evaluate("document.querySelector('.results-text').textContent.includes('Codex')"));
        await evaluate("document.querySelector('.minutes-ledger summary').click()");
        assert.ok(await evaluate("document.querySelector('.minutes-ledger pre').textContent.includes('台帳')"));
        assert.ok(await evaluate("document.querySelector('.minutes-document table')?.textContent.includes('担当')"));
        assert.equal(await evaluate("!!document.querySelector('iframe[title=成果物プレビュー],img[alt=pptxページのプレビュー]')"), false);
        assert.equal(await evaluate("[...document.querySelectorAll('a.download')].some(a=>a.textContent==='Markdownをダウンロード')"), true);
        const markdownURL = await evaluate("[...document.querySelectorAll('a.download')].find(a=>a.textContent==='Markdownをダウンロード').href");
        const markdownResponse = await fetch(markdownURL);
        assert.match(markdownResponse.headers.get('content-type')!, /text\/markdown/);
        assert.match(markdownResponse.headers.get('content-disposition')!, /attachment/);
        assert.match(await markdownResponse.text(), /## 宿題/);
        const pdfURL = await evaluate("[...document.querySelectorAll('a.download')].find(a=>a.textContent==='PDFをダウンロード')?.href || ''");
        if (pdfURL) {
            const pdf = await fetch(pdfURL);
            assert.equal(pdf.headers.get('content-type'), 'application/pdf');
            assert.match(pdf.headers.get('content-disposition')!, /attachment/);
            assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(), '%PDF');
        } else assert.ok(await evaluate("document.querySelector('.pdf-note')?.textContent.includes('PDFは作れませんでした')"));
        assert.ok(await evaluate("document.querySelector('.minutes-document').getBoundingClientRect().bottom <= document.querySelector('.feedback-row').getBoundingClientRect().top"), '本文がAI直し欄に重ならない');
        const minutesShot = await send('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile('test-results/verification/minutes-done-1280.png', Buffer.from(minutesShot.data, 'base64'));
        assert.equal(await evaluate('document.documentElement.scrollHeight <= innerHeight'), true);
        await click('編集');
        await wait("document.querySelector('[aria-label=議事録のMarkdown]')");
        assert.ok(await evaluate("document.querySelector('.minutes-editor').getBoundingClientRect().bottom <= document.querySelector('.feedback-row').getBoundingClientRect().top"), '編集欄と保存ボタンがAI直し欄に重ならない');
        const editShot = await send('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile('test-results/verification/minutes-edit-1280.png', Buffer.from(editShot.data, 'base64'));
        const beforeEdit = await evaluate("document.querySelector('.minutes-source').value");
        await evaluate("(()=>{const el=document.querySelector('.minutes-source');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,el.value+'\\n手動保存の動作確認。\\n');el.dispatchEvent(new Event('input',{bubbles:true}));})()");
        await wait("document.querySelector('.minutes-toolbar').textContent.includes('未保存')");
        await evaluate("(()=>{const el=document.querySelector('[aria-label=完了後の直し指示]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'決定事項を確認');el.dispatchEvent(new Event('input',{bubbles:true}));})()");
        await wait("document.querySelector('#minutes-save-first')?.textContent.includes('先に保存してください')");
        assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='直しを送る').disabled"), true);
        await click('直しを送る');
        assert.equal(await evaluate("document.querySelector('.minutes-source').value"), beforeEdit + '\n手動保存の動作確認。\n');
        await click('表示');
        assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='直しを送る').disabled"), true);
        assert.ok(await evaluate("!document.querySelector('.minutes-document').textContent.includes('手動保存の動作確認')"));
        await click('編集');
        assert.equal(await evaluate("document.querySelector('.minutes-source').value"), beforeEdit + '\n手動保存の動作確認。\n');
        // Give the saving state a deterministic observation window, without changing the server.
        await evaluate("window.__originalFetch=window.fetch;window.fetch=async(...args)=>{if(args[1]?.body?.includes('save-minutes'))await new Promise(r=>setTimeout(r,300));return window.__originalFetch(...args)}");
        await click('保存してPDFを作り直す');
        await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='保存中…' && b.disabled)");
        assert.equal(await evaluate("document.querySelector('.minutes-source').disabled"), true);
        await wait("document.querySelector('.minutes-document')?.textContent.includes('手動保存の動作確認')");
        await evaluate("window.fetch=window.__originalFetch");
        await wait("!document.querySelector('#minutes-save-first') && ![...document.querySelectorAll('button')].find(b=>b.textContent==='直しを送る').disabled");
        assert.match(await fetch(markdownURL).then(r=>r.text()), /手動保存の動作確認/);
        await evaluate("(()=>{const el=document.querySelector('[aria-label=完了後の直し指示]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'決定事項を確認');el.dispatchEvent(new Event('input',{bubbles:true}));})()");
        await click('直しを送る');
        await wait("document.querySelector('.minutes-document')?.textContent.includes('手動保存の動作確認') && document.querySelector('[aria-label=完了後の直し指示]')?.placeholder==='1周の直しを実施済みです'");
        await click('編集');
        assert.ok(await evaluate("document.querySelector('.minutes-source').value.includes('手動保存の動作確認')"));
        await evaluate("(()=>{const el=document.querySelector('.minutes-source');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,el.value+'\\nAI修正後の保存確認。\\n');el.dispatchEvent(new Event('input',{bubbles:true}));})()");
        await click('保存してPDFを作り直す');
        await wait("document.querySelector('.minutes-document')?.textContent.includes('AI修正後の保存確認')");
        await click('新しく作る');
        await click('提案');
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await wait("matchMedia('(prefers-reduced-motion: reduce)').matches");
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.discover')).animationName"), 'none');
        // 動きを減らす設定でも、フォーカス・左右キー・Escで扱える。
        await evaluate("document.querySelector('[data-palette=auto]').focus()");
        await wait("document.querySelector('.palette-popup')");
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.palette-popup')).animationName"), 'none');
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight' });
        await wait("document.activeElement?.getAttribute('data-palette') !== 'auto' && document.querySelector('.palette-popup-colors')");
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
        await wait("!document.querySelector('.palette-popup')");
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
        assert.deepEqual(errors, [], 'ブラウザ実行時エラーが無い');
        await send('Target.closeTarget', { targetId }, false);
    }
    finally {
        ws?.close();
        child.kill();
        if (child.pid) {
            if (process.platform === 'win32')
                await new Promise<void>(resolve => { const c = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); c.on('close', () => resolve()); c.on('error', () => resolve()); });
            else
                child.kill();
        }
    }
});
