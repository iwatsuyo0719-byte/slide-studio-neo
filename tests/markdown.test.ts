import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHTML } from '../lib/markdown';

test('Markdown：見出し・太字・コード・引用・水平線・段落', () => {
    const html = markdownToHTML('# 表題\n\n## 見出し\n### 小見出し\n\n本文 **強調** と `**そのまま**`\n続き\n\n> 引用\n\n---');
    for (const expected of ['<h1>表題</h1>', '<h2>見出し</h2>', '<h3>小見出し</h3>', '<strong>強調</strong>', '<code>**そのまま**</code>', '<blockquote><p>引用</p></blockquote>', '<hr>', '続き</p>']) assert.ok(html.includes(expected), expected);
});
test('Markdown：表のヘッダー・セルと未確認の印', () => {
    const html = markdownToHTML('| 担当 | 内容 | 期限 |\n| :--- | ---: | :---: |\n| **担当者** | `<確認>` | （未確認） |');
    assert.match(html, /<thead><tr><th>担当<\/th>/);
    assert.match(html, /<td><strong>担当者<\/strong><\/td>/);
    assert.match(html, /<code>&lt;確認&gt;<\/code>/);
    assert.match(html, /class="unconfirmed">（未確認）/);
    assert.doesNotMatch(markdownToHTML('a | b\n文字 | 文字'), /<table>/);
});
test('Markdown：順序付き・順序なしの箇条と1段の入れ子', () => {
    assert.equal(markdownToHTML('- 親\n  1. 子\n  2. 子2\n- 親2'), '<ul><li>親<ol><li>子</li><li>子2</li></ol></li><li>親2</li></ul>');
    assert.equal(markdownToHTML('1. 一\n2. 二\n\n段落'), '<ol><li>一</li><li>二</li></ol>\n<p>段落</p>');
});
test('Markdown：HTML・属性・リンクは実行可能なHTMLにならない', () => {
    const html = markdownToHTML('# <script>alert("x")</script>\n\n**<img src=x onerror=alert(1)>** & \'\n\n`<svg/onload=alert(1)>`\n\n[実行](javascript:alert(1))\n\n| a |\n| --- |\n| <iframe src=x> |');
    assert.doesNotMatch(html, /<(script|img|svg|iframe|a)\b/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&quot;x&quot;/);
    assert.match(html, /&amp; &#39;/);
});
