// デスクトップに「SLIDE STUDIO NEO」のショートカットを作る（Windows）。npm run shortcut
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
    console.log('ショートカットの自動作成は Windows だけです。start-neo.cmd の代わりに npm run app で起動してください。');
    process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 窓を出さずに起動するため、start-neo.vbs を wscript で動かす（準備・ビルドが要る時だけ窓が出る）
const target = path.join(root, 'start-neo.vbs');
// デスクトップの場所（OneDrive へ移した場合も含む）は WScript.Shell に聞く
const vbs = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'neo-shortcut-')), 'make.vbs');
fs.writeFileSync(vbs, [
    'Set sh = CreateObject("WScript.Shell")',
    'desk = sh.SpecialFolders("Desktop")',
    'Set link = sh.CreateShortcut(desk & "\\SLIDE STUDIO NEO.lnk")',
    'link.TargetPath = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe"',
    'link.Arguments = Chr(34) & WScript.Arguments(0) & Chr(34)',
    'link.WorkingDirectory = WScript.Arguments(1)',
    'link.Description = "SLIDE STUDIO NEO を起動してブラウザで開く"',
    'link.IconLocation = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\\System32\\imageres.dll,186"',
    'link.Save',
    'WScript.Echo desk & "\\SLIDE STUDIO NEO.lnk"',
].join('\r\n'));
try {
    const made = execFileSync('cscript', ['//nologo', vbs, target, root], { encoding: 'utf8', windowsHide: true }).trim();
    console.log('デスクトップにショートカットを作りました：' + made);
    console.log('ダブルクリックするとブラウザで SLIDE STUDIO NEO が開きます。サーバーは窓を出さずに裏で動き、サインアウト・再起動まで動き続けます。');
} finally {
    fs.rmSync(path.dirname(vbs), { recursive: true, force: true });
}
