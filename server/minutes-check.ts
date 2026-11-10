import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicText } from './store';

type Result = { status: '合格' | '不合格' | '未判定'; evidence: string };
const compact = (s: string) => s.normalize('NFKC').replace(/\s/g, '');
// 規則が許す短い語（「未確認」「継続」など）は発言の引用ではないので照合しない
const allowedQuote = (q: string) => /^(?:未確認|継続|なし|xx|［\s*］)$/.test(q.trim());
const numbers = (s: string) => [...new Set(s.normalize('NFKC').match(/\d+(?:[,，]\d{3})*(?:\.\d+)?/g) || [])];
const cells = (s: string) => s.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

export function checkMinutes(minutes: string, ledger: string, material: string, attachments: string[] = [], unreadable: string[] = []) {
    const checks: Record<string, Result> = {};
    const set = (key: string, status: Result['status'], evidence: string) => { checks[key] = { status, evidence }; };
    const headings = [...minutes.matchAll(/^##\s+(.+?)\s*#*\s*$/gm)];
    const required = ['冒頭情報', '決定事項', '宿題', '論点と経緯', '次回の確認事項'];
    // 「## 1. 冒頭情報」のような番号付きの見出しも同じ見出しとして扱う
    const title = (h: string) => h.replace(/^(?:\d+[.．、)）]\s*|[①-⑨]\s*)/, '');
    const indices = required.map(h => headings.findIndex(m => title(m[1]).startsWith(h)));
    set('構成', indices.every((n, i) => n >= 0 && (!i || n > indices[i - 1])) ? '合格' : '不合格', '見出し順：' + headings.map(h => h[1]).join(' → '));
    const task = headings.findIndex(m => title(m[1]).startsWith('宿題'));
    const taskText = task < 0 ? '' : minutes.slice(headings[task].index! + headings[task][0].length, headings[task + 1]?.index);
    const lines = taskText.split(/\r?\n/);
    const table = lines.some((line, i) => {
        const header = cells(line);
        return ['担当', '内容', '期限'].every(h => header.some(c => c.startsWith(h))) &&
            cells(lines[i + 1] || '').length === header.length && cells(lines[i + 1] || '').every(c => /^:?-{3,}:?$/.test(c)) &&
            (lines[i + 2] || '').includes('|') && cells(lines[i + 2]).length === header.length;
    });
    set('宿題の表', table ? '合格' : '不合格', table ? '宿題の節に担当・内容・期限を含むMarkdown表あり' : '宿題の節に必要な列・区切り行・データ行を持つ表がありません');
    const sources = [material, ...attachments].map(compact);
    const unmatchedQuotes = [...new Set([minutes, ledger].flatMap((text, i) => [...text.matchAll(/「([^」]+)」/g)].filter(m => !allowedQuote(m[1]) && !sources.some(s => s.includes(compact(m[1])))).map(m => (i ? 'ledger.md' : 'minutes.md') + '：' + m[0])))];
    set('引用', unmatchedQuotes.length ? unreadable.length ? '未判定' : '不合格' : '合格', unmatchedQuotes.length ? '素材内に見つからない引用：\n' + unmatchedQuotes.join('\n') : '全引用が素材の文字に一致（空白・改行を除外）');
    if (unreadable.length) set('添付の照合範囲', '未判定', '文字を抽出できない添付：' + unreadable.join('、'));
    const sourceNumbers = new Set(numbers(material));
    const numbersToConfirm = numbers(minutes).filter(n => !sourceNumbers.has(n));
    set('数値の出所', numbersToConfirm.length ? '未判定' : '合格', '確認が要る数値（material.mdにない数値）：' + (numbersToConfirm.join('、') || 'なし'));
    const xxCount = (minutes.match(/xx/gi) || []).length;
    const unconfirmedCount = (minutes.match(/（未確認）/g) || []).length;
    // 最終章の末尾に置くプレーンな一覧、または最後の見出しとしての一覧を許容。
    const tail = minutes.slice(headings.find(m => title(m[1]).startsWith('次回の確認事項'))?.index ?? 0);
    const tailLines = tail.split(/\r?\n/);
    const marker = tailLines.findIndex(l => /^(?:#{1,6}\s+|[-*+]\s+|\d+[.．)]\s+)?(?:\*\*)?未確認事項/.test(l));
    const hasUnconfirmedTail = marker >= 0 && !tailLines.slice(marker + 1).some(l => /^#{1,6}\s/.test(l));
    set('未確認表示', hasUnconfirmedTail ? '合格' : '不合格', `xx：${xxCount}件、（未確認）：${unconfirmedCount}件、末尾の未確認事項：${hasUnconfirmedTail ? 'あり' : 'なし'}`);
    const body = minutes.replace(/^#\s+.*$/gm, '').replace(/^##\s+/gm, '').replace(/^[ \t]*\|[\s:|\-]+\|[ \t]*$/gm, '').replace(/[|*_`]/g, '');
    const characterCount = [...compact(body)].length;
    set('分量', characterCount > 2500 ? '不合格' : '合格', `本文${characterCount}字（空白・表記号・表題を除外）。目安1,600〜1,800字、多い時約2,500字。短い文書は報告のみ`);
    const ledgerShorter = compact(ledger).length < compact(material).length;
    const ledgerTableOnly = ledger.trim().length > 0 && ledger.split(/\r?\n/).filter(l => l.trim()).every(l => /^\s*\|.*\|\s*$/.test(l));
    set('台帳', '未判定', `報告のみ：素材より短い：${ledgerShorter ? 'はい' : 'いいえ'}、表だけ：${ledgerTableOnly ? 'はい' : 'いいえ'}（台帳${compact(ledger).length}字／素材${compact(material).length}字）`);
    return { checks, unmatchedQuotes, numbersToConfirm, xxCount, unconfirmedCount, hasUnconfirmedTail, characterCount, ledgerShorter, ledgerTableOnly };
}

export async function checkMinutesFiles(dir: string) {
    const read = (file: string) => fs.readFile(path.join(dir, file), 'utf8');
    const attachments: string[] = [], unreadable: string[] = [];
    for (const file of await fs.readdir(path.join(dir, 'attachments')).catch(() => [])) {
        if (!/\.(txt|md|csv)$/i.test(file)) { unreadable.push(file); continue; }
        try { attachments.push(await read(path.join('attachments', file))); }
        catch { unreadable.push(file); }
    }
    const result = checkMinutes(await read('minutes.md'), await read('ledger.md'), await read('material.md'), attachments, unreadable);
    const markdown = '# 議事録の機械検査\n\n' + Object.entries(result.checks).map(([key, r]) => `## ${key}：${r.status}\n${r.evidence}\n`).join('\n');
    await atomicText(path.join(dir, 'check-auto.json'), JSON.stringify(result, null, 2) + '\n');
    await atomicText(path.join(dir, 'check-auto.md'), markdown);
    return Object.entries(result.checks).filter(([, r]) => r.status === '不合格').map(([key]) => key);
}
