import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const base = process.env.NEO_TEST_URL || 'http://127.0.0.1:3210';
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
test('HTMLの静止／動く選択と通常・拡大プレビューのページ送りを通す', { timeout: 420000 }, async () => {
    const bootstrap = await fetch(base + '/api/neo').then(r => r.json());
    assert.equal(bootstrap.fake, true, '実AIでは実行しません');
    // 使い捨てのブラウザフォルダと確認画像は、失敗した時だけ残して原因を見られるようにする。成功したら消す
    const runId = crypto.randomUUID();
    const profile = path.resolve('test-results/browser-test-' + runId);
    const shots = path.resolve('test-results/verification-' + runId);
    let passed = false;
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
        await fetch(base, { signal: AbortSignal.timeout(120000) });
        await send('Page.navigate', { url: base });
        await wait("document.querySelector('.status-line')?.textContent.includes('偽AI')");
        assert.equal(await evaluate("!!document.querySelector('[aria-label=\"HTMLの動き\"]')"), false);
        await click('html');
        await wait("document.querySelector('[aria-label=\"HTMLの動き\"]')");
        assert.equal(await evaluate("document.querySelector('[aria-label=\"HTMLの動き\"] button').getAttribute(\"aria-pressed\")"), 'true');
        await click('動く');
        await click('html');
        assert.equal(await evaluate("!!document.querySelector('[aria-label=\"HTMLの動き\"]')"), false);
        await click('html');
        assert.equal(await evaluate("document.querySelector('[aria-label=\"HTMLの動き\"] button').getAttribute(\"aria-pressed\")"), 'true');
        await click('動く');
        await click('pptx');
        await click('簡易');
        await material('架空の週次報告です。今週は計画を確認します。');
        await click('作成する');
        await wait("document.querySelector('.work-chat')");
        assert.equal(await evaluate("document.querySelector('fieldset').disabled"), true);
        await wait("document.querySelector('.motion-inline iframe')");
        assert.equal(await evaluate("document.documentElement.scrollHeight <= innerHeight"), true);
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.motion-inline iframe')).pointerEvents"), 'auto');
        const iframeSession = async (selector: string) => {
            for (let n = 0; n < 200; n++) {
                const { root } = await send('DOM.getDocument');
                const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
                const { node } = await send('DOM.describeNode', { nodeId });
                const frame = node.frameId ? { id: node.frameId } : null;
                if (frame) {
                    try {
                        const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'motion-test' });
                        const candidate = { sessionId: session, contextId: executionContextId };
                        if (await inFrame(candidate, '!!document.querySelector("#next")')) return candidate;
                    } catch { /* 別プロセスのiframeはTargetから接続する */ }
                }
                const { targetInfos } = await send('Target.getTargets', {}, false);
                const info = targetInfos.filter((t: any) => t.type === 'iframe' && t.targetId === frame?.id).at(-1);
                if (info) {
                    const candidate = { sessionId: (await send('Target.attachToTarget', { targetId: info.targetId, flatten: true }, false)).sessionId as string };
                    if (await inFrame(candidate, '!!document.querySelector("#next")')) return candidate;
                }
                await delay(50);
            }
            assert.fail('sandbox付きiframeを接続できません');
        };
        const inFrame = async (id: { sessionId: string; contextId?: number }, expression: string) => {
            const n = ++sequence;
            const result = await new Promise<any>((resolve, reject) => {
                const timer = setTimeout(() => reject(Error('iframe timeout')), 10000);
                pending.set(n, { resolve: v => { clearTimeout(timer); resolve(v); }, reject });
                ws!.send(JSON.stringify({ id: n, sessionId: id.sessionId, method: 'Runtime.evaluate', params: { expression, returnByValue: true, ...(id.contextId ? { contextId: id.contextId } : {}) } }));
            });
            if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        const clickNext = async (selector: string, frame: { sessionId: string; contextId?: number }) => {
            const outer = await evaluate('(()=>{const r=document.querySelector(' + JSON.stringify(selector) + ').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()');
            const inner = await inFrame(frame, '(()=>{const r=document.querySelector("#next").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
            const x = outer.x + inner.x * outer.w / 1920, y = outer.y + inner.y * outer.h / 1080;
            await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x, y });
            await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x, y });
            for (let n = 0; n < 40 && await inFrame(frame, 'document.querySelectorAll("section")[1].hidden'); n++) await delay(25);
            assert.equal(await inFrame(frame, 'document.querySelectorAll("section")[1].hidden'), false);
        };
        const inline = await iframeSession('.motion-inline iframe');
        await clickNext('.motion-inline iframe', inline);
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
        assert.equal(await inFrame(inline, 'document.querySelectorAll("section")[0].hidden'), false);
        await click('大きく見る');
        await wait("document.querySelector('.preview-dialog[open] iframe')");
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.preview-dialog iframe')).pointerEvents"), 'auto');
        assert.equal(await evaluate("document.querySelector('.preview-dialog [aria-label=次のページ]').disabled"), true);
        const expanded = await iframeSession('.preview-dialog iframe');
        await clickNext('.preview-dialog iframe', expanded);
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '1', code: 'Digit1', windowsVirtualKeyCode: 49 });
        assert.equal(await inFrame(expanded, 'document.querySelectorAll("section")[0].hidden'), false);
        await evaluate("document.querySelector('[aria-label=拡大プレビューを閉じる]').click()");
        await click('履歴');
        await wait("document.querySelector('.history-list')");
        assert.ok(await evaluate("document.querySelector('.history-list').textContent.includes('html（動く）')"));
        assert.deepEqual(errors, [], 'ブラウザ実行時エラーが無い');
        await send('Target.closeTarget', { targetId }, false);
        passed = true;
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
        if (passed) {
            // Chromeが終了してフォルダを離すまで少し待ってから消す
            for (let n = 0; n < 10; n++) {
                try { await fs.rm(profile, { recursive: true, force: true }); await fs.rm(shots, { recursive: true, force: true }); break; }
                catch { await delay(500); }
            }
        }
        else console.log('失敗時の記録を残しました：' + profile + ' / ' + shots);
    }
});
