// Escape all source text before adding our own limited markup; links and raw HTML stay text.
export function escapeHTML(text: string): string {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function inline(text: string): string {
    const escaped = escapeHTML(text);
    return escaped.split(/(`[^`]+`)/g).map(part => part.startsWith('`') && part.endsWith('`')
        ? '<code>' + part.slice(1, -1) + '</code>'
        : part.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/（未確認）|未確認/g, '<span class="unconfirmed">$&</span>')).join('');
}
function cells(line: string): string[] {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}
const item = (line: string) => line.match(/^(\s*)(-|\d+\.)\s+(.+)$/);
export function markdownToHTML(markdown: string): string {
    const lines = markdown.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').split('\n');
    let at = 0;
    const table = (n: number) => n + 1 < lines.length && lines[n].includes('|') && cells(lines[n + 1]).every(c => /^:?-{3,}:?$/.test(c)) && cells(lines[n]).length === cells(lines[n + 1]).length;
    const special = (n: number) => /^(#{1,3}\s|\s*>|\s*(?:-{3,}|\*{3,})\s*$)/.test(lines[n]) || !!item(lines[n]) || table(n);
    function list(indent: number, depth: number): string {
        const first = item(lines[at])!;
        const tag = first[2] === '-' ? 'ul' : 'ol';
        let out = '<' + tag + '>';
        while (at < lines.length) {
            const current = item(lines[at]);
            if (!current || current[1].length !== indent || (current[2] === '-' ? 'ul' : 'ol') !== tag) break;
            out += '<li>' + inline(current[3]);
            at++;
            while (at < lines.length) {
                const next = item(lines[at]);
                if (!next || next[1].length <= indent) break;
                if (depth < 1) out += list(next[1].length, depth + 1);
                else { out += ' ' + inline(next[3]); at++; }
            }
            out += '</li>';
        }
        return out + '</' + tag + '>';
    }
    const output: string[] = [];
    while (at < lines.length) {
        const line = lines[at];
        if (!line.trim()) { at++; continue; }
        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        if (heading) { output.push('<h' + heading[1].length + '>' + inline(heading[2]) + '</h' + heading[1].length + '>'); at++; }
        else if (/^\s*(?:-{3,}|\*{3,})\s*$/.test(line)) { output.push('<hr>'); at++; }
        else if (table(at)) {
            const headers = cells(line);
            let html = '<table><thead><tr>' + headers.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
            at += 2;
            while (at < lines.length && lines[at].trim() && lines[at].includes('|')) {
                const row = cells(lines[at++]);
                html += '<tr>' + headers.map((_, n) => '<td>' + inline(row[n] || '') + '</td>').join('') + '</tr>';
            }
            output.push(html + '</tbody></table>');
        }
        else if (item(line)) output.push(list(item(line)![1].length, 0));
        else if (/^\s*>/.test(line)) {
            const quote: string[] = [];
            while (at < lines.length && /^\s*>/.test(lines[at])) quote.push(lines[at++].replace(/^\s*>\s?/, ''));
            output.push('<blockquote>' + markdownToHTML(quote.join('\n')) + '</blockquote>');
        }
        else {
            const paragraph = [line]; at++;
            while (at < lines.length && lines[at].trim() && !special(at)) paragraph.push(lines[at++]);
            output.push('<p>' + inline(paragraph.join('\n')) + '</p>');
        }
    }
    return output.join('\n');
}
