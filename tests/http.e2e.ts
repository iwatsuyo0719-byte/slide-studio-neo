import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
const base = process.env.NEO_TEST_URL || 'http://127.0.0.1:3210';
test('HTTP：入力保存→設計図承認→完了→安全なHTML配信→履歴', { timeout: 30000 }, async () => {
    const b = await fetch(base + '/api/neo').then(r => r.json());
    assert.equal(b.fake, true);
    assert.equal(b.palettes.length, 100);
    const headers = { 'Content-Type': 'application/json', 'x-neo-token': b.token };
    const input = { title: 'HTTP動作確認', audience: '社外', purpose: '提案', formats: ['html'], level: '詳細', palette: 'auto', brand: '#225966', material: '架空の提案資料です', ai: { provider: 'codex', model: 'gpt-6.1-sol', depth: 'auto' } };
    const form = new FormData();
    form.append('input', JSON.stringify(input));
    const response = await fetch(base + '/api/neo', { method: 'POST', headers: { 'x-neo-token': b.token }, body: form });
    assert.equal(response.status, 200);
    const r = await response.json();
    async function wait(status: string) {
        for (let i = 0; i < 200; i++) {
            const state = await fetch(base + '/api/neo?id=' + encodeURIComponent(r.id)).then(r => r.json());
            if (state.status === status)
                return state;
            if (state.status === 'error')
                assert.fail(state.error);
            await delay(50);
        }
        assert.fail('状態の待機に失敗：' + status);
    }
    const design = await wait('design');
    assert.ok(design.design);
    assert.equal(design.files.includes('index.html'), false);
    assert.equal(design.paletteCandidates.length, 3);
    const approved = await fetch(base + '/api/neo', { method: 'POST', headers, body: JSON.stringify({ action: 'approve', id: r.id, palette: '026' }) });
    assert.equal(approved.status, 200);
    const done = await wait('done');
    assert.ok(done.check && done.review);
    const url = base + '/api/files/' + encodeURIComponent(r.id) + '/index.html?preview=1';
    const file = await fetch(url);
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-security-policy')!, /sandbox allow-scripts/);
    assert.match(file.headers.get('content-security-policy')!, /connect-src 'none'/);
    assert.match(await file.text(), /偽AI/);
    const denied = await fetch(base + '/api/files/' + encodeURIComponent(r.id) + '/state.json');
    assert.equal(denied.status, 404);
    const crossOrigin = await fetch(base + '/api/neo', { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: JSON.stringify({ action: 'stop', id: r.id }) });
    assert.equal(crossOrigin.status, 400);
    const missingToken = await fetch(base + '/api/neo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop', id: r.id }) });
    assert.equal(missingToken.status, 400);
    const list = await fetch(base + '/api/neo?history=1').then(r => r.json());
    assert.ok(list.some((v: {
        id: string;
    }) => v.id === r.id));
});
