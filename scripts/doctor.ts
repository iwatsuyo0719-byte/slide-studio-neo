import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execute, locate, statuses, type CLIStatus } from '../server/cli';
import { findBrowser } from '../server/pdf';
import { workspace } from '../server/store';
import { secretKeys } from '../lib/domain';

export interface Check {
    label: string;
    status: '合格' | '不足' | '任意';
    required: boolean;
    detail: string;
    remedy?: string;
}
export function nodeSupported(version: string): boolean {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
    return !!match && (+match[1] > 20 || (+match[1] === 20 && +match[2] >= 9));
}
export function aiChecks(value: Record<'claude' | 'codex', CLIStatus>): Check[] {
    const checks: Check[] = (['claude', 'codex'] as const).map(provider => ({
        label: provider === 'claude' ? 'Claude Code CLI' : 'Codex CLI',
        status: value[provider].usable ? '合格' : '不足', required: false,
        detail: `${value[provider].installed ? '検出済み' : '未検出'}・${value[provider].message}（APIキーでのログインは不可）`,
        remedy: provider === 'claude'
            ? 'Claude Codeを公式手順でインストールし、claude auth login でclaude.aiのサブスクにログインしてください。'
            : 'npm install -g @openai/codex の後、codex login でChatGPTにログインしてください。',
    }));
    checks.push({ label: '生成用AI（少なくとも1つ）', status: value.claude.usable || value.codex.usable ? '合格' : '不足', required: true,
        detail: 'Claude Code または Codex CLI', remedy: '上のどちらか1つのCLIをインストールし、サブスクでログインしてください。' });
    return checks;
}
export function exitCode(checks: Check[]): number {
    return checks.some(check => check.required && check.status === '不足') ? 1 : 0;
}
export function report(checks: Check[]): string {
    return checks.flatMap(check => [
        `${check.status}：${check.label} — ${check.detail}`,
        ...(check.status === '不足' && check.remedy ? [`  対処：${check.remedy}`] : []),
    ]).join('\n');
}
const exists = (file: string) => fs.stat(file).then(s => s.isFile()).catch(() => false);
export async function writable(dir: string): Promise<boolean> {
    let probe: string | undefined;
    try {
        await fs.mkdir(dir, { recursive: true });
        probe = await fs.mkdtemp(path.join(dir, '.neo-doctor-'));
        const file = path.join(probe, 'write-check');
        await fs.writeFile(file, 'doctor', { flag: 'wx' });
        await fs.unlink(file);
        await fs.rmdir(probe);
        probe = undefined;
        return true;
    } catch { return false; }
    finally {
        if (probe) {
            await fs.unlink(path.join(probe, 'write-check')).catch(() => {});
            await fs.rmdir(probe).catch(() => {});
        }
    }
}
async function powerPoint(): Promise<string | null> {
    if (process.platform !== 'win32') return null;
    const onPath = await locate('POWERPNT');
    if (onPath) return onPath.bin;
    const reg = await locate('reg');
    if (!reg) return null;
    for (const root of ['HKLM', 'HKCU']) {
        const output = await execute(reg, ['query', `${root}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\POWERPNT.EXE`, '/ve'], process.cwd(), undefined, undefined, undefined, 5000).catch(() => '');
        const file = output.match(/REG_SZ\s+(.+)/)?.[1]?.trim().replace(/^"|"$/g, '');
        if (file && await exists(file)) return file;
    }
    return null;
}
export async function doctor(): Promise<number> {
    const checks: Check[] = [];
    const add = (label: string, ok: boolean, detail: string, remedy: string) => checks.push({ label, status: ok ? '合格' : '不足', required: true, detail, remedy });
    add('Node.js（20.9以上）', nodeSupported(process.versions.node), process.version, 'Node.js 20.9以上（LTS推奨）をインストールしてください。');
    add('依存（node_modules）', await fs.stat(path.join(process.cwd(), 'node_modules')).then(s => s.isDirectory()).catch(() => false), 'repoのnode_modules', 'repoのルートで npm install を実行してください。');
    // 偽AIモードでも、このコマンドは本物のCLIのログイン状態だけを調べる。
    const fake = process.env.NEO_FAKE_AI;
    delete process.env.NEO_FAKE_AI;
    try { checks.push(...aiChecks(await statuses(true))); }
    finally { if (fake !== undefined) process.env.NEO_FAKE_AI = fake; }
    // アプリの機械検査と同じ優先順位でPythonを選ぶ。
    const python = await locate('python') || await locate('python3');
    const version = python ? await execute(python, ['--version'], process.cwd(), undefined, undefined, undefined, 10000).catch(() => '') : '';
    add('Python', !!version.trim(), version.trim() || '未検出・実行不可', 'Pythonをインストールし、python または python3 をPATHに追加してください。');
    const pptx = python && version ? await execute(python, ['-c', 'import pptx; print(pptx.__version__)'], process.cwd(), undefined, undefined, undefined, 10000).catch(() => '') : '';
    add('python-pptx', !!pptx.trim(), pptx.trim() || '未検出（pptx作成に必要）', '上で検出したPythonに pip install python-pptx（または python -m pip install python-pptx）を実行してください。');
    const browser = await findBrowser();
    add('Chrome / Edge', !!browser && await exists(browser.bin), browser?.bin || '未検出（議事録PDF・機械検査に必要）', 'ChromeかEdgeをインストールしてください。自動検出されない場合は NEO_BROWSER に実行ファイルのパスを設定してください。');
    if (process.platform === 'win32') {
        const office = await powerPoint();
        checks.push({ label: 'PowerPoint（Windows）', status: '任意', required: false, detail: office || '未検出。pptx画像化用。LibreOfficeでも代替できます。' });
    }
    const libreOffice = await locate('soffice');
    checks.push({ label: 'LibreOffice', status: '任意', required: false, detail: libreOffice?.bin || '未検出。代替のpptx画像化用。使う場合はインストールしsofficeをPATHに追加してください。' });
    add('作業場所（書き込み）', await writable(workspace), workspace, 'NEO_WORKSPACE に書き込み可能なフォルダを指定するか、このフォルダの書き込み権限を確認してください。');
    console.log(report(checks));
    if (Object.entries(process.env).some(([key, value]) => !!value && secretKeys.includes(key.toUpperCase())))
        console.log('注意：APIキーの環境変数が設定されています。NEOは起動時に外すので課金されない（生成用CLIの子プロセスから除外）。');
    console.log('確認範囲：CLIのヘルプ・ログイン状態のみ。AIへの問い合わせ・生成は行っていません。');
    const code = exitCode(checks);
    console.log(code ? '生成できる状態か：不足あり（必須項目を整えて再実行してください）' : '生成できる状態か：はい（必須項目がそろっています。利用上限・実生成は未確認）');
    return code;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    doctor().then(code => { process.exitCode = code; }).catch(() => {
        console.error('不足：環境確認に失敗しました。PATH・アクセス権を確認して npm run doctor を再実行してください。');
        console.error('生成できる状態か：確認できませんでした');
        process.exitCode = 1;
    });
}
