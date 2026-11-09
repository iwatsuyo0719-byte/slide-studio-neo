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
    const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--window-size=1280,720', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
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
            if (m.method === 'Runtime.exceptionThrown')
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
        await click('OKで本番へ');
        await wait("document.querySelector('.result-top')?.textContent.includes('できあがりました')");
        assert.ok(await evaluate("document.querySelector('iframe[title=成果物プレビュー]')?.getAttribute('sandbox')==='allow-scripts'"));
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
