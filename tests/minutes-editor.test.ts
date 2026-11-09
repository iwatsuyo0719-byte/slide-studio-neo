import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MinutesEditor from '../components/MinutesEditor';

test('議事録表示：変換例外時は安全な生テキストを表示し、編集ボタンを残す', t => {
    const markdown = '# <script>生の議事録</script>';
    const replace = String.prototype.replace;
    let injected = false;
    t.mock.method(String.prototype, 'replace', function(this: string, ...args: unknown[]) {
        if (!injected && String(this) === markdown) { injected = true; throw new RangeError('conversion failed'); }
        return Reflect.apply(replace, this, args);
    });
    const html = renderToStaticMarkup(createElement(MinutesEditor, { markdown, pending: false, onSave() {}, onDirtyChange() {} }));
    assert.ok(injected);
    assert.match(html, /<pre class="minutes-document"/);
    assert.match(html, /# &lt;script&gt;生の議事録&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, />編集<\/button>/);
});
