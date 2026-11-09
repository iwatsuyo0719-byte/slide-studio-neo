import fs from 'node:fs/promises';
import path from 'node:path';
import { defaults, validateSettings, parsePalettes, type Settings, type RecordData, type HistorySample } from '../lib/domain';
export const repo = process.cwd();
export const workspace = path.join(repo, 'workspace');
export const requests = path.join(workspace, 'requests');
export async function jsonRead<T>(file: string, fallback: T): Promise<T> {
    try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            return structuredClone(fallback);
        throw e;
    }
}
export async function atomic(file: string, data: unknown) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(data, null, 2));
    for (let attempt = 0;; attempt++) {
        try {
            await fs.rename(temp, file);
            break;
        }
        catch (e) {
            // Windowsでは読み取り中・ウイルス対策の検査中に置き換えが一時的に拒否されるため、合計約3秒まで待ってやり直す
            if (attempt >= 19 || !['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code || '')) {
                await fs.rm(temp, { force: true }).catch(() => { });
                throw e;
            }
            await new Promise(resolve => setTimeout(resolve, Math.min(25 * (attempt + 1), 200)));
        }
    }
}
export async function settings(): Promise<Settings> {
    const file = path.join(workspace, 'settings.json');
    const s = validateSettings(await jsonRead(file, defaults));
    await fs.mkdir(workspace, { recursive: true });
    try {
        await fs.writeFile(file, JSON.stringify(s, null, 2), { flag: 'wx' });
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
            throw e;
    }
    return s;
}
export async function palettes() { return parsePalettes(await fs.readFile(path.join(repo, 'references/palettes/PALETTES_100.md'), 'utf8')); }
export function requestDir(id: string) {
    if (!/^\d{4}-\d{2}-\d{2}-[^/\\:]+$/.test(id) || id.includes('..'))
        throw Error('依頼IDが不正です');
    return path.join(requests, id);
}
// 最後に保存した状態を覚えておき、画面の更新確認のたびにファイルを開かない（Windowsでは開いている間の置き換えが拒否されるため）
// 別のプロセス（テストなど）が書き換えた時に気づけるよう、保存した時の更新時刻も控え、ファイルを開かない stat で比べる
const memory = (globalThis as typeof globalThis & { neoRecords?: Map<string, { record: RecordData; mtimeMs: number }> }).neoRecords ??= new Map<string, { record: RecordData; mtimeMs: number }>();
export async function readRecord(id: string) {
    const file = path.join(requestDir(id), 'state.json');
    const cached = memory.get(id);
    if (cached) {
        const stat = await fs.stat(file).catch(() => null);
        if (stat && stat.mtimeMs === cached.mtimeMs)
            return structuredClone(cached.record);
        memory.delete(id);
    }
    const r = await jsonRead<RecordData | null>(file, null);
    if (!r)
        throw Error('依頼が見つかりません');
    return r;
}
const saveQueues = new Map<string, Promise<void>>();
export async function save(r: RecordData) {
    r.updated = Date.now();
    const snapshot = structuredClone(r);
    const next = (saveQueues.get(r.id) || Promise.resolve()).catch(() => { }).then(async () => { const file = path.join(requestDir(r.id), 'state.json'); await atomic(file, snapshot); const stat = await fs.stat(file).catch(() => null); if (stat) memory.set(r.id, { record: snapshot, mtimeMs: stat.mtimeMs }); else memory.delete(r.id); });
    saveQueues.set(r.id, next);
    try {
        await next;
    }
    finally {
        if (saveQueues.get(r.id) === next)
            saveQueues.delete(r.id);
    }
}
const historyFile = () => path.join(workspace, process.env.NEO_FAKE_AI === '1' ? 'history.fake.json' : 'history.json');
export async function history() { return jsonRead<HistorySample[]>(historyFile(), []); }
let historyQueue = Promise.resolve();
export async function sample(sample: HistorySample) { historyQueue = historyQueue.catch(() => { }).then(async () => atomic(historyFile(), [...await history(), sample].slice(-1000))); await historyQueue; }
export async function allRecords() { await fs.mkdir(requests, { recursive: true }); const names = await fs.readdir(requests); const out = await Promise.all(names.map(n => readRecord(n).catch(() => null))); return out.filter((r): r is RecordData => !!r).sort((a, b) => b.created - a.created); }
export async function safeFile(id: string, parts: string[]) {
    const base = await fs.realpath(requestDir(id));
    const root = await fs.realpath(requests);
    if (!base.startsWith(root + path.sep))
        throw Error('依頼フォルダの場所が不正です');
    const p = path.resolve(base, ...parts);
    if (!p.startsWith(base + path.sep))
        throw Error('ファイルの場所が不正です');
    const real = await fs.realpath(p);
    if (!real.startsWith(base + path.sep))
        throw Error('リンク先のファイルは公開できません');
    const relative = path.relative(base, real).replaceAll('\\', '/');
    if (!/^(index\.html|slides\.pptx|palette-comparison\.html|request\.md|material\.md|design\.md|check\.md|review\.md|preview\/[\w.-]+\.(png|jpg))$/.test(relative))
        throw Error('このファイルは公開できません');
    return real;
}
export async function artifacts(r: RecordData) {
    const base = requestDir(r.id);
    const files: string[] = [];
    for (const name of ['index.html', 'slides.pptx', 'palette-comparison.html']) {
        if (await fs.stat(path.join(base, name)).then(s => s.isFile() && s.size > 0).catch(() => false))
            files.push(name);
    }
    for (const name of await fs.readdir(path.join(base, 'preview')).catch(() => [])) {
        if (/\.(png|jpg)$/.test(name))
            files.push('preview/' + name);
    }
    r.files = files;
    for (const key of ['design', 'check', 'review'] as const) {
        r[key] = await fs.readFile(path.join(base, key + '.md'), 'utf8').catch(() => '');
    }
}
