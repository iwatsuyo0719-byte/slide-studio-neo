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

test('HTTP：議事録のMarkdown・PDFをattachment配信し、範囲外のファイルを拒否する', { timeout: 30000 }, async () => {
    const boot = await fetch(base + '/api/neo').then(r => r.json());
    assert.equal(boot.fake, true);
    const form = new FormData();
    form.append('input', JSON.stringify({ title: 'HTTP議事録確認', audience: '社内', purpose: '議事録', formats: ['html'], level: '簡易', palette: null, brand: null, material: '架空の週次会議。担当と期限は未確認。', ai: { provider: 'codex', model: 'gpt-6.1-sol', depth: 'auto' } }));
    const response = await fetch(base + '/api/neo', { method: 'POST', headers: { 'x-neo-token': boot.token }, body: form });
    assert.equal(response.status, 200);
    const created = await response.json();
    let done;
    for (let n = 0; n < 400; n++) {
        const state = await fetch(base + '/api/neo?id=' + encodeURIComponent(created.id)).then(r => r.json());
        if (state.status === 'done') { done = state; break; }
        if (state.status === 'error') assert.fail(state.error);
        await delay(50);
    }
    assert.ok(done, '議事録の完了待ち');
    assert.equal(done.selectedLevel, '詳細');
    assert.ok(done.review);
    const saveBody = JSON.stringify({ action: 'save-minutes', id: created.id, minutes: '# HTTPで編集した議事録\n\n保存を確認。' });
    const headers = { 'Content-Type': 'application/json', 'x-neo-token': boot.token };
    for (const deniedHeaders of [{ 'Content-Type': 'application/json' }, { ...headers, origin: 'https://evil.example' }]) {
        assert.equal((await fetch(base + '/api/neo', { method: 'POST', headers: deniedHeaders, body: saveBody })).status, 400);
    }
    const savedResponse = await fetch(base + '/api/neo', { method: 'POST', headers, body: saveBody });
    assert.equal(savedResponse.status, 200);
    done = await savedResponse.json();
    assert.match(done.minutes, /HTTPで編集した議事録/);
    assert.ok(!done.files.some((f: string) => /html|pptx|preview/.test(f)));
    const url = base + '/api/files/' + encodeURIComponent(created.id) + '/';
    const markdown = await fetch(url + 'minutes.md?download=1');
    assert.equal(markdown.status, 200);
    assert.equal(markdown.headers.get('content-type'), 'text/markdown; charset=utf-8');
    assert.match(markdown.headers.get('content-disposition')!, /^attachment;/);
    assert.match(await markdown.text(), /HTTPで編集した議事録/);
    if (done.files.includes('minutes.pdf')) {
        const pdf = await fetch(url + 'minutes.pdf?download=1');
        assert.equal(pdf.status, 200);
        assert.equal(pdf.headers.get('content-type'), 'application/pdf');
        assert.match(pdf.headers.get('content-disposition')!, /^attachment;/);
        assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    } else assert.match(done.pdfNote, /PDFは作れませんでした/);
    for (const file of ['state.json', '..%5Csettings.json', '..%2Fminutes.pdf']) assert.equal((await fetch(url + file)).status, 404);
});
