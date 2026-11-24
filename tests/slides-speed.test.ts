import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { create, act, current } from '../server/runner';
import { history, readRecord, save } from '../server/store';
import { historyKey, estimate, type Input } from '../lib/domain';

process.env.NEO_FAKE_AI = '1';
process.env.NEO_FAKE_DELAY_MS = '40';
const input: Input = { title: '速度の回帰確認', audience: '社内', purpose: '報告', formats: ['html', 'pptx'], level: '簡易', palette: 'auto', brand: '', material: '架空の素材', ai: { provider: 'codex', model: 'gpt-6.1-sol', depth: 'high' } };
async function waitFor(id: string, status: string) {
    for (let n = 0; n < 1000; n++) {
        const r = await current(id);
        if (r.status === status) return r;
        if (r.status === 'error') assert.fail(r.error);
        await delay(10);
    }
    assert.fail('状態待ちタイムアウト：' + status);
}

test('簡易とAUTO→簡易は設計図・本番をまとめ、両形式を作り検査する。時間も通算する', async () => {
    for (const level of ['簡易', 'AUTO'] as const) {
        const r = await create({ ...input, level }, []);
        const done = await waitFor(r.id, 'done');
        assert.equal(done.selectedLevel, '簡易');
        assert.equal(done.phase, 'production');
        assert.deepEqual(done.input.ai, input.ai);
        assert.equal(done.timings['本番'], undefined);
        assert.equal(done.timings['設計図'], undefined);
        assert.ok(done.timings['設計図・本番']! >= 80);
        assert.ok(done.timings['検査']! >= 40);
        assert.ok(done.activeMs >= done.timings['設計図・本番']! + done.timings['検査']!);
        assert.equal(done.logs.filter(l => l.includes('いまの段階：')).length, 2);
        assert.ok(done.files.includes('index.html') && done.files.includes('slides.pptx'));
        assert.ok(done.check);
        assert.deepEqual(done.paletteCandidates, ['026']);
        const samples = await history();
        const sample = samples.filter(s => s.key === historyKey(done.input, '簡易') && s.phase === 'production').at(-1);
        assert.ok(sample);
        assert.ok(sample.ms >= done.timings['設計図・本番']! + done.timings['検査']!);
        assert.ok(sample.ms <= done.activeMs);
    }
});

test('AUTO→詳細は設計図で止まり、承認待ち時間を本番の時間へ加えない', async () => {
    const r = await create({ ...input, level: 'AUTO', audience: '社外' }, []);
    const design = await waitFor(r.id, 'design');
    assert.equal(design.stage, '設計図');
    assert.equal(design.timings['設計図・本番'], undefined);
    assert.ok(design.timings['設計図']);
    assert.ok(!design.files.includes('index.html') && !design.files.includes('slides.pptx'));
    // 承認待ちを長時間にした記録でも、承認時にphaseStartが更新される。
    const waiting = await readRecord(r.id);
    waiting.phaseStart -= 86400000;
    waiting.activeMs += 86400000;
    await save(waiting);
    const before = Date.now();
    await act(r.id, 'approve', { palette: '001' });
    const done = await waitFor(r.id, 'done');
    assert.ok(done.activeMs <= Date.now() - before);
    assert.ok(done.timings['本番']);
    assert.equal(done.chosenPalette, '001');
});

test('質問への回答後も簡易は本番起動を飛ばす', async () => {
    const r = await create({ ...input, material: '[question] 架空の素材' }, []);
    const asked = await waitFor(r.id, 'question');
    const before = await readRecord(r.id);
    before.activeMs += 10000;
    await save(before);
    await act(r.id, 'answer', { answer: asked.question!.options[0] });
    const done = await waitFor(r.id, 'done');
    assert.ok(done.activeMs >= 10000 + done.timings['設計図・本番']! + done.timings['検査']!);
    assert.equal(done.timings['本番'], undefined);
    assert.match(done.design, /A：今月/);
});

test('旧本番だけのsampleは簡易の合計時間の見積もりへ混ぜない', () => {
    const key = historyKey(input, '簡易');
    assert.match(key, /continuous-slides-v1$/);
    const history = Array.from({ length: 3 }, () => ({ key: key.replace('|continuous-slides-v1', ''), phase: 'production' as const, ms: 1000 }));
    assert.deepEqual(estimate(input, '簡易', 'production', history), estimate(input, '簡易', 'production'));
    const total = Array.from({ length: 3 }, () => ({ key, phase: 'production' as const, ms: 100000 }));
    assert.deepEqual(estimate(input, '簡易', 'design', total), [80000, 120000]);
});

test('完了後の手直し時間は簡易版の生成時間sampleへ追加しない', async () => {
    const r = await create(input, []);
    await waitFor(r.id, 'done');
    const before = (await history()).length;
    await act(r.id, 'revise', { feedback: '見出しを短く' });
    await waitFor(r.id, 'done');
    assert.equal((await history()).length, before);
});

test('サーバー再起動で統合段階のまま残った記録も、設計図から同じ起動で再開する', async () => {
    const r = await create(input, []);
    await waitFor(r.id, 'done');
    const interrupted = await readRecord(r.id);
    interrupted.status = 'stopped';
    interrupted.stage = '設計図・本番';
    interrupted.resumeStage = undefined;
    await save(interrupted);
    await act(r.id, 'resume');
    const done = await waitFor(r.id, 'done');
    assert.equal(done.timings['本番'], undefined);
    assert.equal(done.logs.filter(l => l.includes('いまの段階：設計図・本番')).length, 2);
});
