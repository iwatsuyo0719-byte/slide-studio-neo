// Run: node --import tsx tests/bundle-sizes.ts. No AI CLI is started.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bundleRules } from '../server/bundle';
import type { Input, Stage } from '../lib/domain';
const root = process.cwd();
const base: Input = { title: '生成コスト比較', audience: '社内', purpose: '報告', material: '売上は120、前年は100。出所は社内月報。', formats: ['html'], level: '簡易', palette: '026', brand: '', ai: { provider: 'codex', model: 'gpt-6.1-sol', depth: 'auto' } };
const stages: Stage[] = ['設計図', '本番', '検査', 'レビュー', '手直し'];
const bytes = async (p: string) => (await fs.stat(path.join(root, p))).size;
// Same relevant rule set read in full at every invocation; palettes and unused
// E files excluded, so this does not overstate the old README-guided baseline.
const common = await bytes('prompts/README.md') + await bytes('prompts/core.md') + await bytes('prompts/evidence.md');
for (const input of [base, { ...base, purpose: '提案' as const, formats: ['pptx' as const], level: '詳細' as const, material: '施策AとBの比較。導入計画を提案する。' }]) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-bundle-sizes-'));
    const design = input.purpose === '報告' ? '型07 滝分解、E03 ひと工夫したグラフ' : '型02 エグゼクティブサマリ、型03 クロージング決定、型37 フェーズガント、E08 評価表、E12 ロードマップ';
    const evidence = input.purpose === '報告' ? ['E03'] : ['E08', 'E12'];
    let baseline = common;
    for (const id of evidence) baseline += await bytes('prompts/evidence/' + id + '.md');
    try {
        await fs.writeFile(path.join(dir, 'material.md'), input.material);
        await fs.writeFile(path.join(dir, 'request.md'), input.purpose + '。出力：' + input.formats.join('、'));
        await fs.writeFile(path.join(dir, 'design.md'), design);
        console.log(input.purpose + '/' + input.formats[0] + '/' + input.level + ' baseline=' + baseline + ' bytes/stage');
        let total = 0;
        const selected = input.level === '簡易' ? stages.slice(0, 3) : stages;
        for (const stage of selected) {
            const name = await bundleRules({ root, dir, input, stage });
            const size = (await fs.stat(path.join(dir, name))).size;
            total += size;
            console.log(stage + ': ' + size + ' bytes (' + ((1 - size / baseline) * 100).toFixed(1) + '% reduction)');
        }
        console.log('total: ' + total + ' / ' + baseline * selected.length + ' bytes (' + ((1 - total / (baseline * selected.length)) * 100).toFixed(1) + '% reduction)');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
