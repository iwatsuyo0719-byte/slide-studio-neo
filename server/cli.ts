import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { subscriptionEnv, effectiveAI, type AIChoice, type Provider, type Level, type Settings } from '../lib/domain';
export interface Command {
    bin: string;
    prefix: string[];
}
export interface CLIStatus {
    installed: boolean;
    usable: boolean;
    message: string;
}
export async function locate(name: string): Promise<Command | null> {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        for (const ext of process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']) {
            const file = path.join(dir, name + ext);
            if (!await fs.stat(file).then(s => s.isFile()).catch(() => false))
                continue;
            if (ext === '.cmd') {
                const text = await fs.readFile(file, 'utf8');
                const hit = text.match(/"%dp0%\\([^"\r\n]+\.js)"/i) || text.match(/"%~dp0\\([^"\r\n]+\.js)"/i);
                if (hit) {
                    const script = path.resolve(dir, hit[1]);
                    if (await fs.stat(script).catch(() => null))
                        return { bin: process.execPath, prefix: [script] };
                }
                continue;
            }
            return { bin: file, prefix: [] };
        }
    }
    return null;
}
export function execute(command: Command, args: string[], cwd: string, onData?: (s: string) => void, onChild?: (c: ChildProcess) => void, signal?: AbortSignal, timeout = 0): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command.bin, [...command.prefix, ...args], { cwd, env: subscriptionEnv(process.env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        onChild?.(child);
        const abort = () => { void terminate(child); };
        signal?.addEventListener('abort', abort, { once: true });
        let out = '', err = '';
        const timer = timeout ? setTimeout(() => { child.kill(); reject(Error('CLI確認がタイムアウトしました')); }, timeout) : undefined;
        child.stdout?.on('data', d => { const s = String(d); out = (out + s).slice(-200000); onData?.(s); });
        child.stderr?.on('data', d => { const s = String(d); err = (err + s).slice(-200000); onData?.(s); });
        child.on('error', e => { clearTimeout(timer); reject(e); });
        child.on('close', code => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            if (signal?.aborted)
                return reject(Error('中断しました'));
            if (code !== 0)
                return reject(Error(('CLIが停止しました（終了コード ' + code + '）。' + err + ' ' + out).slice(-4000)));
            resolve(out || err);
        });
    });
}
// codex login status は環境によって10秒前後かかるため余裕を持たせる
const STATUS_TIMEOUT = 30000;
let cached: {
    at: number;
    value: Record<Provider, CLIStatus>;
} | undefined;
export async function statuses(force = false): Promise<Record<Provider, CLIStatus>> {
    if (process.env.NEO_FAKE_AI === '1')
        return { claude: { installed: true, usable: true, message: '偽AI・利用枠を使いません' }, codex: { installed: true, usable: true, message: '偽AI・利用枠を使いません' } };
    if (!force && cached && Date.now() - cached.at < 30000)
        return cached.value;
    const value = {} as Record<Provider, CLIStatus>;
    await Promise.all((['claude', 'codex'] as Provider[]).map(async (p) => {
        const cmd = await locate(p);
        if (!cmd) {
            value[p] = { installed: false, usable: false, message: p + ' をインストールし、' + p + ' でサブスクにログインしてください' };
            return;
        }
        try {
            if (p === 'codex') {
                const out = await execute(cmd, ['login', 'status'], process.cwd(), undefined, undefined, undefined, STATUS_TIMEOUT);
                const ok = /Logged in using ChatGPT/i.test(out);
                value[p] = { installed: true, usable: ok, message: ok ? 'ChatGPTログイン済み' : 'codex login でChatGPTにログインしてください（API認証は使えません）' };
            }
            else {
                const help = await execute(cmd, ['auth', '--help'], process.cwd(), undefined, undefined, undefined, STATUS_TIMEOUT);
                if (/\bstatus\b/.test(help)) {
                    const out = await execute(cmd, ['auth', 'status'], process.cwd(), undefined, undefined, undefined, STATUS_TIMEOUT);
                    let data;
                    try {
                        data = JSON.parse(out);
                    }
                    catch { }
                    const ok = data?.loggedIn === true && /claude\.ai|oauth/i.test(data?.authMethod || '') && !/api/i.test(data?.authMethod || '');
                    value[p] = { installed: true, usable: ok, message: ok ? 'Claudeサブスクでログイン済み' : 'claude auth login でサブスクにログインしてください' };
                }
                else
                    value[p] = { installed: true, usable: true, message: 'インストール済み・ログインは未確認（claude で確認）' };
            }
        }
        catch {
            value[p] = { installed: true, usable: false, message: p + ' のログイン確認に失敗。CLIでログイン後「再確認」を押してください' };
        }
    }));
    cached = { at: Date.now(), value };
    return value;
}
export function cliArgs(ai: AIChoice, level: Level, s: Settings, cwd: string, prompt: string, readOnly = false, prompts = '', documentOnly = false) {
    const choice = effectiveAI(ai, level, s, readOnly);
    if (ai.provider === 'codex')
        return ['exec', '-m', choice.model, '-c', 'model_reasoning_effort=' + choice.depth, '--sandbox', readOnly ? 'read-only' : 'workspace-write', '--skip-git-repo-check', '--color', 'never', prompt];
    const tools = readOnly ? ['Read(' + cwd.replaceAll('\\', '/') + '/**)', 'Read(' + prompts.replaceAll('\\', '/') + '/**)'] : ['Read(' + cwd.replaceAll('\\', '/') + '/**)', 'Read(' + prompts.replaceAll('\\', '/') + '/**)', 'Write(' + cwd.replaceAll('\\', '/') + '/**)', 'Edit(' + cwd.replaceAll('\\', '/') + '/**)', ...(documentOnly ? [] : ['Bash(python build_slides.py)', 'Bash(python3 build_slides.py)'])];
    return ['-p', prompt, '--model', choice.model, '--effort', String(choice.depth), '--add-dir', cwd, '--add-dir', prompts, '--tools', readOnly ? 'Read' : documentOnly ? 'Read,Write,Edit' : 'Read,Write,Edit,Bash', '--allowedTools', ...tools, '--permission-mode', 'dontAsk'];
}
export async function terminate(child: ChildProcess | undefined) {
    if (!child?.pid)
        return;
    if (process.platform === 'win32') {
        await new Promise<void>(resolve => { const c = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); c.on('error', () => { child.kill(); resolve(); }); c.on('close', code => { if (code !== 0)
            child.kill('SIGTERM'); resolve(); }); });
    }
    else
        child.kill('SIGTERM');
}
