import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkChat } from '../lib/work-chat';

test('Codex reports are separated from command operations and CLI metadata', () => {
    const result = parseWorkChat([
        '[12:01:02] いまの段階：本番',
        'OpenAI Codex v1\nmodel: test\nuser\nRead the source.\nthinking\nPrivate planning.\ncodex\n素材を確認します。\nexec\npowershell -Command Get-Content material.md in C:\\work succeeded in 20ms:\nraw source text\ncodex\n3ページを作りました。\ntokens used\n12,345',
    ]);
    assert.deepEqual(result.messages.map(m => [m.speaker, m.text]), [
        ['NEO', 'いまの段階：本番'], ['AI', '素材を確認します。'], ['AI', '3ページを作りました。'],
    ]);
    assert.deepEqual(result.messages[2].operations, ['powershell -Command Get-Content material.md']);
    assert.equal(result.messages[2].provider, 'codex');
    assert.equal(result.messages[2].time, '12:01:02');
    assert.match(result.fullLog, /raw source text/);
    assert.doesNotMatch(result.messages.map(m => m.text).join('\n'), /12,345|Private planning|raw source/);
});

test('stage changes retain their order and timestamp; machine inspections become cards', () => {
    const result = parseWorkChat(['[09:00:00] いまの段階：設計図', '[09:02:00] いまの段階：本番', '[09:04:00] 機械検査（2秒、画像3枚）：不合格なし']);
    assert.deepEqual(result.messages.map(m => m.time), ['09:00:00', '09:02:00', '09:04:00']);
    assert.equal(result.messages[2].speaker, '機械検査');
});

test('cumulative snapshots and the timestamped final copy produce one complete report', () => {
    const first = 'codex\n素材を確認';
    const second = first + 'しました。\nexec\nnode count.mjs';
    const final = second + ' in C:\\work succeeded in 10ms:\n3\ncodex\n作りました。\ntokens used\n123';
    const result = parseWorkChat(['[11:00:00] いまの段階：本番', first, second, second, '[11:01:00] ' + final]);
    assert.deepEqual(result.messages.map(m => m.text), ['いまの段階：本番', '素材を確認しました。', '作りました。']);
    assert.equal(result.messages[2].operations.length, 1);
});

test('rolling truncated snapshots merge their overlap without losing the report', () => {
    const result = parseWorkChat(['codex\n最初の報告です。\nexec\nnode check.mjs', 'exec\nnode check.mjs in C:\\work succeeded in 10ms:\nok\ncodex\n最後の報告です。']);
    assert.deepEqual(result.messages.map(m => m.text), ['最初の報告です。', '最後の報告です。']);
    assert.deepEqual(result.messages[1].operations, ['node check.mjs']);
});

test('identical reports in different stages are kept; duplicate server events are removed', () => {
    const result = parseWorkChat(['[11:00:00] いまの段階：本番', '[11:00:00] いまの段階：本番', 'codex\n完了しました。', '[11:02:00] いまの段階：検査', 'codex\n完了しました。']);
    assert.equal(result.messages.filter(m => m.text === '完了しました。').length, 2);
    assert.equal(result.messages.filter(m => m.text === 'いまの段階：本番').length, 1);
});

test('Claude labelled output is recognized and unknown original output remains available', () => {
    const source = '\u001b[32mClaude:\u001b[0m\n議事録を作りました。\n';
    const result = parseWorkChat([source]);
    assert.equal(result.messages[0].provider, 'claude');
    assert.equal(result.messages[0].text, '議事録を作りました。');
    assert.equal(result.fullLog, source);
    const unknown = '[11:00:00] 不明な形式の出力';
    assert.equal(parseWorkChat([unknown]).fullLog, unknown);
});

test('empty logs return an empty timeline and full log', () => {
    assert.deepEqual(parseWorkChat([]), { messages: [], fullLog: '' });
    assert.deepEqual(parseWorkChat(['', '  ']).messages, []);
});

test('an unlabeled retained tail does not guess the AI provider', () => {
    const result = parseWorkChat(['3ページを作りました。\ntokens used\n12,345']);
    assert.equal(result.messages[0].text, '3ページを作りました。');
    assert.equal(result.messages[0].provider, undefined);
});

test('時刻付きの短いNEO行は、AI出力に同じ語があっても消えない', async () => {
    const { parseWorkChat } = await import('../lib/work-chat');
    const logs = ['[10:00:00] いまの段階：設計図', 'codex\n作業しています。完了しました\n', '[10:05:00] 完了しました'];
    const parsed = parseWorkChat(logs);
    assert.ok(parsed.messages.some(m => m.speaker === 'NEO' && m.text.includes('完了しました') && m.time === '10:05:00'));
});
