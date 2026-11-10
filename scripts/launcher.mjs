// start-neo.cmd から呼ぶ小さな補助（依存なしのNode.js）。
//   running      … NEO（またはそのポートのサーバー）が応答すれば 0、無ければ 2
//   needs-build  … ビルドが無い・ソースより古ければ 1、そのまま起動できれば 0
//   open         … サーバーが応答したらブラウザで開く（最大3分待つ）
//   say <key>    … 黒い窓に出す日本語の案内（cmd の UTF-8 の扱いで崩れないよう Node で出す）
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.NEO_PORT || '3000';
const url = `http://127.0.0.1:${port}`;

async function responds() {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        return res.status < 500;
    } catch { return false; }
}
// ポートを誰かが使っているか（開発サーバーは最初の表示に時間がかかるので、HTTPではなく接続できるかで見る）
function listening() {
    return new Promise(resolve => {
        const socket = net.connect({ host: '127.0.0.1', port: Number(port) });
        socket.setTimeout(2000);
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
        socket.once('error', () => resolve(false));
    });
}
function newest(p) {
    let latest = 0;
    let stat;
    try { stat = fs.statSync(p); } catch { return 0; }
    if (stat.isFile()) return stat.mtimeMs;
    for (const name of fs.readdirSync(p)) latest = Math.max(latest, newest(path.join(p, name)));
    return latest;
}
function needsBuild() {
    let built;
    try { built = fs.statSync(path.join(root, '.next', 'BUILD_ID')).mtimeMs; } catch { return true; }
    const sources = ['app', 'components', 'lib', 'server', 'package.json', 'next.config.ts', 'postcss.config.mjs'];
    return sources.some(s => newest(path.join(root, s)) > built);
}
function openBrowser() {
    if (process.env.NEO_NO_BROWSER === '1') { console.log('OPEN ' + url); return; } // 動作確認用
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
}

const mode = process.argv[2];
if (mode === 'say') {
    const messages = {
        install: '初回の準備をしています（npm install）...',
        build: '画面を準備しています（ビルド）。初回は数分かかります...',
        starting: ['', 'SLIDE STUDIO NEO を起動しています。準備ができるとブラウザが開きます。', 'この窓を閉じると終了します。', ''].join('\n'),
        failed: ['', '起動できませんでした。npm run doctor で必要な物を確かめてください。'].join('\n'),
    };
    console.log(messages[process.argv[3]] || '');
    process.exit(0);
}
if (mode === 'running') process.exit(await listening() ? 0 : 2);
if (mode === 'needs-build') process.exit(needsBuild() ? 1 : 0);
if (mode === 'open') {
    for (let n = 0; n < 180; n++) {
        if (await responds()) { openBrowser(); process.exit(0); }
        await new Promise(r => setTimeout(r, 1000));
    }
    process.exit(1);
}
console.error('使い方：node scripts/launcher.mjs running|needs-build|open|say <key>');
process.exit(64);
