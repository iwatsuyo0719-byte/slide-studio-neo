import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { addFit, fitHtmlFile, FIT_MARKER } from '../server/fit';

test('画面サイズ調整：bodyの直前に挿入し、再適用しても増えない', () => {
    const html = '<html><body><section>本文</section></body></html>';
    const fitted = addFit(html);
    assert.ok(fitted.indexOf(FIT_MARKER) < fitted.indexOf('</body>'));
    assert.ok(fitted.indexOf('</script>') < fitted.indexOf('</body>'));
    assert.equal(addFit(fitted), fitted);
    assert.equal(fitted.split(FIT_MARKER).length - 1, 1);
    assert.ok(addFit('<body>本文</BODY>').indexOf(FIT_MARKER) < addFit('<body>本文</BODY>').indexOf('</BODY>'));
});

test('画面サイズ調整：bodyの終了が無ければ末尾に追加する', () => {
    const html = '<section>本文</section>';
    assert.ok(addFit(html).startsWith(html + '\n<style ' + FIT_MARKER));
    assert.ok(addFit(html).trimEnd().endsWith('</script>'));
});

test('画面サイズ調整：CSSはscreen内だけに置き、印刷へ適用しない', () => {
    const css = addFit('').match(/<style[^>]*>([\s\S]*?)<\/style>/)![1].trim();
    assert.match(css, /^@media screen\s*\{/);
    let depth = 0;
    for (let i = css.indexOf('{'); i < css.length; i++) {
        if (css[i] === '{') depth++;
        if (css[i] === '}') depth--;
        if (depth === 0) assert.equal(i, css.length - 1);
    }
    assert.equal(depth, 0);
    assert.match(css, /zoom: var\(--neo-slide-zoom, 1\)/);
    assert.doesNotMatch(css, /@media print/);
});

test('画面サイズ調整：縦横の小さい倍率を選び、resizeで再計算する', () => {
    const script = addFit('').match(/<script>([\s\S]*?)<\/script>/)![1];
    let scale = '', resize = () => {};
    const window = { innerWidth: 1920, innerHeight: 1080, addEventListener: (event: string, fn: () => void) => { assert.equal(event, 'resize'); resize = fn; } };
    const document = { documentElement: { style: { setProperty: (name: string, value: string) => { assert.equal(name, '--neo-slide-zoom'); scale = value; } } } };
    vm.runInNewContext(script, { window, document });
    assert.equal(Number(scale), 1);
    for (const [width, height] of [[1536, 864], [1600, 600], [2560, 1440]]) {
        window.innerWidth = width; window.innerHeight = height; resize();
        assert.equal(Number(scale), Math.min(width / 1920, height / 1080));
    }
});

test('画面サイズ調整：index.htmlだけを更新し、無ければ何もしない', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-fit-test-'));
    try {
        await fitHtmlFile(dir);
        assert.deepEqual(await fs.readdir(dir), []);
        const file = path.join(dir, 'index.html');
        const html = '<body><section>本文</section></body>';
        await fs.writeFile(file, html);
        await fitHtmlFile(dir);
        assert.equal(await fs.readFile(file, 'utf8'), addFit(html));
        await fitHtmlFile(dir);
        assert.equal(await fs.readFile(file, 'utf8'), addFit(html));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
