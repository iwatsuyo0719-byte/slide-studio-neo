import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { RecordData, Stage } from '../lib/domain';
// A small valid, editable one-slide OOXML file; no AI/Office process is needed in fake mode.
function zip(entries: Record<string, string>) {
    const local: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, text] of Object.entries(entries)) {
        const n = Buffer.from(name), data = Buffer.from(text);
        let crc = 0xffffffff;
        for (const b of data) {
            crc ^= b;
            for (let k = 0; k < 8; k++)
                crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        crc = (crc ^ 0xffffffff) >>> 0;
        const h = Buffer.alloc(30);
        h.writeUInt32LE(0x04034b50);
        h.writeUInt16LE(20, 4);
        h.writeUInt32LE(crc, 14);
        h.writeUInt32LE(data.length, 18);
        h.writeUInt32LE(data.length, 22);
        h.writeUInt16LE(n.length, 26);
        local.push(h, n, data);
        const c = Buffer.alloc(46);
        c.writeUInt32LE(0x02014b50);
        c.writeUInt16LE(20, 4);
        c.writeUInt16LE(20, 6);
        c.writeUInt32LE(crc, 16);
        c.writeUInt32LE(data.length, 20);
        c.writeUInt32LE(data.length, 24);
        c.writeUInt16LE(n.length, 28);
        c.writeUInt32LE(offset, 42);
        central.push(c, n);
        offset += h.length + n.length + data.length;
    }
    const c = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(central.length / 2, 8);
    end.writeUInt16LE(central.length / 2, 10);
    end.writeUInt32LE(c.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, c, end]);
}
export function fakePptx() {
    return zip({
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
        '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
        'ppt/presentation.xml': '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
        'ppt/_rels/presentation.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
        'ppt/slides/slide1.xml': '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="700000" y="1000000"/><a:ext cx="10500000" cy="3000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ja-JP" sz="3200"/><a:t>SLIDE STUDIO NEO 偽AIの動作確認用です</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
    });
}
export async function fakeStage(r: RecordData, dir: string, stage: Stage, signal: AbortSignal) {
    await delay(Number(process.env.NEO_FAKE_DELAY_MS || 1000), undefined, { signal });
    const put = (name: string, s: string | Buffer) => fs.writeFile(path.join(dir, name), s);
    if (r.input.material.includes('[error]') && r.attempt === 0 && stage === '本番')
        throw Error('偽AI：利用上限に達しました。もう一方のAIで続けられます');
    if (stage === '設計図') {
        if (r.input.material.includes('[question]') && !r.asked) {
            await put('question.json', JSON.stringify({ text: 'どの期間を対象にしますか？', options: ['A：今月', 'B：今四半期', 'C：未定のまま進める'] }));
            return;
        }
        const selected = r.input.level === 'AUTO' ? (r.input.audience === '社外' || r.input.material.length > 600 ? '詳細' : '簡易') : r.input.level;
        await put('decision.json', JSON.stringify({ level: selected, reason: r.input.level === 'AUTO' ? '読み手・素材量から' + selected + '版を選びました' : '指定された' + selected + '版で進めます' }));
        await put('design.md', '# 設計図（偽AI）\n\n## 1. 結論・型A\n素材の確認から次の一手を決める\n\n## 2. 根拠・E01\n提供された資料に沿って比較する\n\n## 3. お願い・型A\n担当と期日を決める\n\n### 数字台帳・残った質問\n数値の追加が必要です。未提示の値は未確認とします。\n' + (r.answer ? '回答：' + r.answer : '') + '\n' + (await fs.readFile(path.join(dir, 'design-feedback.md'), 'utf8').catch(() => '')));
        if (r.input.palette === 'auto') {
            await put('palette-candidates.json', JSON.stringify(selected === '詳細' ? ['026', '001', '079'] : ['026']));
            if (selected === '詳細')
                await put('palette-comparison.html', '<!doctype html><html lang="ja"><meta charset="utf-8"><title>配色比較</title><body><h1>偽AIの配色比較</h1><p>026 浅瀬アクア ／ 001 桜ミルク ／ 079 真夜中の金</p></body></html>');
        }
    }
    else if (stage === '本番') {
        if (r.input.formats.includes('html'))
            await put('index.html', '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>偽AIプレビュー</title><style>body{background:#F0FDFF;color:#225966;font:20px system-ui;margin:6%}h1{font-size:34px}.bars{display:flex;gap:20px;height:180px;align-items:end}.bars i{background:#32A5B1;flex:1}button{padding:10px}</style><h1>素材から、伝わるスライドへ</h1><p>偽AIの動作確認用です。数値は見本です。</p><div class="bars"><i style="height:40%"></i><i style="height:65%"></i><i style="height:85%"></i></div><button onclick="this.textContent=\'動作しました\'">表示を試す</button></html>');
        if (r.input.formats.includes('pptx'))
            await put('slides.pptx', fakePptx());
    }
    else if (stage === '検査')
        await put('check.md', '# 自己検査（偽AI）\n見出し・はみ出し・重なり・最小文字・空白：テスト出力\n数字の出所：未達（実素材の検証はしていません）\n改善案：実データの出所と対象期間を補う\n');
    else if (stage === 'レビュー')
        await put('review.md', '# Codexレビュー（偽AI）\n総合判定：動作確認用\n1枚目／中／数値が見本／実データで確認する\n');
    else if (stage === '手直し')
        await put('revision.md', '偽AI：1周の手直し・修正後確認を模擬しました。\n');
}
