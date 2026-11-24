import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { applyTextEdits, escapeText, validateEdits } from '../server/text-edit';
import { injectPreviewTools } from '../server/preview-tools';
import { create, act, current } from '../server/runner';
import { requestDir, save } from '../server/store';
import { GET } from '../app/api/files/[id]/[...file]/route';
import { POST } from '../app/api/neo/route';
import { token } from '../server/http';
import type { Input } from '../lib/domain';
process.env.NEO_FAKE_AI = '1';
process.env.NEO_FAKE_DELAY_MS = '1';
const input: Input = { title: '文字編集テスト', audience: '社内', purpose: '報告', formats: ['html'], level: '簡易', palette: '026', brand: '#225966', material: '架空の素材', ai: { provider: 'claude', model: 'opus', depth: 'auto' } };
async function done(id: string) {
    for (let i = 0; i < 400; i++) {
        const record = await current(id);
        if (record.status === 'done') return record;
        assert.notEqual(record.status, 'error', record.error);
        await delay(10);
    }
    throw Error('timeout');
}
test('文字の一意性・エスケープ・同時編集を元ソースで判定する', () => {
    const source = '<p>唯一</p><p>重複</p><b>重複</b><script>const text="JSだけ";</script>';
    const result = applyTextEdits(source, [{ before: '唯一', after: '<img src=x> & " \' ' }, { before: '重複', after: '不可' }, { before: 'JSだけ', after: '不可' }, { before: '無い', after: '不可' }]);
    assert.deepEqual(result.results.map(r => r.saved), [true, false, false, false]);
    assert.match(result.source, /&lt;img src=x&gt; &amp; &quot; &#39;/);
    assert.ok(result.source.includes('<script>const text="JSだけ";</script>'));
    assert.ok(result.results.slice(1).every(r => r.reason.includes('AIへの直し指示')));
    for (const encoded of ['A &amp; B &lt; C &gt; D &quot;E&quot; &#39;F&#39;', 'A &#38; B &#x3c; C &gt; D &quot;E&quot; &apos;F&apos;']) {
        const before = 'A & B < C > D "E" \'F\'';
        assert.equal(applyTextEdits('<p>' + encoded + '</p>', [{ before, after: '&新規<>' }]).source, '<p>&amp;新規&lt;&gt;</p>');
    }
    // 属性・<title> に同じ文字があっても重複に数えず、本文だけを書き換える（表紙の見出しを直せるように）
    assert.equal(applyTextEdits('<p title="同文">同文</p>', [{ before: '同文', after: '新' }]).source, '<p title="同文">新</p>');
    assert.equal(applyTextEdits('<title>表紙</title><h1>表紙</h1>', [{ before: '表紙', after: '新' }]).source, '<title>表紙</title><h1>新</h1>');
    // 部分一致では書き換えない（JSが組み立てた「第2章」が別の本文「第2章の概要」に当たらない）
    assert.equal(applyTextEdits('<p>第2章の概要</p>', [{ before: '第2章', after: '不可' }]).results[0].saved, false);
    assert.equal(applyTextEdits('<p title="x > 属性">本文</p>', [{ before: '属性', after: '不可' }]).results[0].saved, false);
    const chain = applyTextEdits('<p>AAA</p><p>BBB</p>', [{ before: 'AAA', after: 'BBB' }, { before: 'BBB', after: 'CCC' }]);
    assert.equal(chain.source, '<p>BBB</p><p>CCC</p>');
    assert.equal(applyTextEdits('<p>AAA</p>', [{ before: 'AAA', after: 'X' }, { before: 'AAA', after: 'Y' }]).source, '<p>AAA</p>');
    assert.equal(escapeText('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
    assert.throws(() => validateEdits([{ before: 'x', after: 'a'.repeat(2001) }]));
    assert.throws(() => validateEdits([]));
});
test('補助スクリプトはpreview=1かつpick/edit=1だけに付く', () => {
    const source = '<html><body><h1>見出し</h1></body></html>';
    for (const query of ['', '?preview=1', '?pick=1', '?edit=1', '?preview=0&edit=1']) assert.equal(injectPreviewTools(source, new URL('http://localhost/' + query)), source);
    for (const mode of ['pick', 'edit']) assert.match(injectPreviewTools(source, new URL('http://localhost/?preview=1&' + mode + '=1')), /data-neo-preview-tools[\s\S]*<\/body>/);
});
test('偽AIで2回の直し・旧記録・版退避・guard付き文字保存・配信を通す', async () => {
    const record = await done((await create(input, [])).id);
    const dir = requestDir(record.id);
    const file = path.join(dir, 'index.html');
    for (let n = 1; n <= 2; n++) {
        const previous = await fs.readFile(file, 'utf8');
        await act(record.id, 'revise', { feedback: '直し' + n });
        assert.equal((await done(record.id)).revisionCount, n);
        const versions = await fs.readdir(path.join(dir, 'versions'));
        assert.equal(versions.length, n);
        const latest = versions.sort().at(-1)!;
        assert.equal(await fs.readFile(path.join(dir, 'versions', latest, 'index.html'), 'utf8'), previous);
    }
    assert.match(await fs.readFile(path.join(dir, 'feedback-history.md'), 'utf8'), /1回目[\s\S]*直し1[\s\S]*2回目[\s\S]*直し2/);
    assert.equal(await fs.readFile(path.join(dir, 'final-feedback.md'), 'utf8'), '直し2');
    const source = '<html><body><section data-page="2"><h1>一つだけ &amp; 数字</h1><p>重複</p><p>重複</p></section></body></html>';
    await fs.writeFile(file, source);
    const body = JSON.stringify({ action: 'edit-text', id: record.id, edits: [{ before: '一つだけ & 数字', after: '<変更> & 完了' }, { before: '重複', after: '不可' }, { before: '無い', after: '不可' }] });
    const unauthorized = await POST(new Request('http://127.0.0.1/api/neo', { method: 'POST', headers: { host: '127.0.0.1' }, body }));
    assert.equal(unauthorized.status, 400);
    process.env.NEO_FAKE_INSPECT = '1';
    process.env.NEO_BROWSER = 'none';
    const response = await POST(new Request('http://127.0.0.1/api/neo', { method: 'POST', headers: { host: '127.0.0.1', 'content-type': 'application/json', 'x-neo-token': token }, body }));
    delete process.env.NEO_FAKE_INSPECT;
    delete process.env.NEO_BROWSER;
    assert.equal(response.status, 200);
    assert.match(await fs.readFile(path.join(dir, 'check-auto.md'), 'utf8'), /機械検査の結果/);
    const edited = await response.json();
    assert.deepEqual(edited.results.map((r: { saved: boolean }) => r.saved), [true, false, false]);
    assert.equal(edited.record.revisionCount, 2);
    assert.equal(edited.record.logs.filter((l: string) => l.includes('いまの段階：手直し')).length, 2);
    assert.match(await fs.readFile(file, 'utf8'), /&lt;変更&gt; &amp; 完了/);
    const versions = await fs.readdir(path.join(dir, 'versions'));
    assert.equal(versions.length, 3);
    assert.equal(await fs.readFile(path.join(dir, 'versions', versions.sort().at(-1)!, 'index.html'), 'utf8'), source);
    for (const query of ['', '?pick=1', '?edit=1', '?preview=1', '?preview=1&pick=1', '?preview=1&edit=1']) {
        const response = await GET(new Request('http://127.0.0.1/api/files/' + record.id + '/index.html' + query, { headers: { host: '127.0.0.1' } }), { params: Promise.resolve({ id: record.id, file: ['index.html'] }) });
        assert.equal(response.status, 200);
        const text = await response.text();
        assert.equal(text.includes('data-neo-preview-tools'), query.includes('preview=1&'));
        assert.match(response.headers.get('content-security-policy')!, /sandbox allow-scripts/);
        assert.doesNotMatch(response.headers.get('content-security-policy')!, /allow-same-origin/);
    }
    const legacy = await current(record.id);
    delete legacy.revisionCount;
    await save(legacy);
    await act(record.id, 'revise', { feedback: '旧記録の続き' });
    assert.equal((await done(record.id)).revisionCount, 2);
    await assert.rejects(() => act(record.id, 'edit-text', { edits: [{ before: 'x', after: 'a'.repeat(2001) }] }), /2,000/);
    const linked = await done((await create(input, [])).id);
    const linkedDir = requestDir(linked.id);
    await fs.mkdir(path.join(linkedDir, 'other'));
    await fs.symlink(path.join(linkedDir, 'other'), path.join(linkedDir, 'versions'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => act(linked.id, 'revise', { feedback: 'リンクは拒否' }), /リンク/);
    assert.equal((await current(linked.id)).status, 'done');
    assert.deepEqual(await fs.readdir(path.join(linkedDir, 'other')), []);
});
