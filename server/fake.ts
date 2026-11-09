import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isMinutes, type RecordData, type Stage } from '../lib/domain';
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
export const fakeMinutes = `# 週次会議 議事録（偽AIの見本）

## 冒頭情報
会議名：週次会議。日時：［　］（未確認）。形式：オンライン。参加者・所属：［　］（未確認）。記録者：［　］（未確認）。

## 決定事項
- 次回までに計画を確認する。

## 宿題
| 担当 | 内容 | 期限 |
|---|---|---|
| 未確認 | 計画を確認する | 未確認 |

## 論点と経緯
計画の確認方法を話し合った。「計画を確認します」との発言を受け、次回までに確認することとした。見込額はxx円（未確認）。金額の確定は継続。

## 次回の確認事項
- 計画の確認結果を共有する。次回日時は［　］（未確認）。

未確認事項
- 日時、参加者の所属・氏名、記録者、担当、期限、見込額、次回日時。
`;
export async function fakeStage(r: RecordData, dir: string, stage: Stage, signal: AbortSignal) {
    await delay(Number(process.env.NEO_FAKE_DELAY_MS || 1000), undefined, { signal });
    const put = (name: string, s: string | Buffer) => fs.writeFile(path.join(dir, name), s);
    if (r.input.material.includes('[error]') && r.attempt === 0 && stage === '本番')
        throw Error('偽AI：利用上限に達しました。もう一方のAIで続けられます');
    if (stage === '設計図') {
        if (!isMinutes(r.input) && r.input.material.includes('[question]') && !r.asked) {
            await put('question.json', JSON.stringify({ text: 'どの期間を対象にしますか？', options: ['A：今月', 'B：今四半期', 'C：未定のまま進める'] }));
            return;
        }
        const selected = r.input.level === 'AUTO' ? (r.input.audience === '社外' || r.input.material.length > 600 ? '詳細' : '簡易') : r.input.level;
        if (!isMinutes(r.input)) await put('decision.json', JSON.stringify({ level: selected, reason: r.input.level === 'AUTO' ? '読み手・素材量から' + selected + '版を選びました' : '指定された' + selected + '版で進めます' }));
        if (isMinutes(r.input)) {
            await put('ledger.md', '# 台帳（偽AI）\n\n## 事実・数値\n会議名：週次会議。日時：［　］（未確認）。見込額：xx円（未確認）。\n\n## 決定\n次回までに計画を確認する。\n\n## 宿題\n| 担当 | 内容 | 期限 |\n|---|---|---|\n| 未確認 | 計画を確認 | 未確認 |\n\n## 相手の発言\n「計画を確認します」\n' + await fs.readFile(path.join(dir, 'design-feedback.md'), 'utf8').catch(() => ''));
            return;
        }
        await put('design.md', '# 設計図（偽AI）\n\n## 1. 結論・型A\n素材の確認から次の一手を決める\n\n## 2. 根拠・E01\n提供された資料に沿って比較する\n\n## 3. お願い・型A\n担当と期日を決める\n\n### 数字台帳・残った質問\n数値の追加が必要です。未提示の値は未確認とします。\n' + (r.answer ? '回答：' + r.answer : '') + '\n' + (await fs.readFile(path.join(dir, 'design-feedback.md'), 'utf8').catch(() => '')));
        if (r.input.palette === 'auto') {
            await put('palette-candidates.json', JSON.stringify(selected === '詳細' ? ['026', '001', '079'] : ['026']));
            if (selected === '詳細')
                await put('palette-comparison.html', '<!doctype html><html lang="ja"><meta charset="utf-8"><title>配色比較</title><body><h1>偽AIの配色比較</h1><p>026 浅瀬アクア ／ 001 桜ミルク ／ 079 真夜中の金</p></body></html>');
        }
    }
    else if (isMinutes(r.input)) {
        if (stage === '本番') await put('minutes.md', fakeMinutes);
        else if (stage === '検査') await put('check.md', '# 自己検査（偽AI）\n構成5項目の順序：見本で確認\n宿題の表（担当・内容・期限）：確認\n素材にない数値：xxを使用（実素材との照合は未達）\n相手の発言：「」の引用（実素材との照合は未達）\n不明点：本文と末尾に未確認を明示\n分量：短い見本（実会議の分量は未確認）\n');
        else if (stage === 'レビュー') await put('review.md', '# Codexレビュー（偽AI）\n総合判定：動作確認用\n素材との食い違い・決定と宿題の取り違え・経緯の飛躍・未確認の付け忘れ：実素材での検証は未確認\n');
        else if (stage === '手直し') {
            const feedback = await fs.readFile(path.join(dir, 'final-feedback.md'), 'utf8').catch(() => '');
            await put('minutes.md', (await fs.readFile(path.join(dir, 'minutes.md'), 'utf8')) + '\n注：偽AIで1周の手直しを確認済み。\n');
            await put('revision.md', '偽AI：minutes.md を1周修正しました。実素材との照合は未確認。\n' + feedback);
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
