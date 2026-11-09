import './workspace';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../server/cli';
test('実際の子プロセスでもAPI環境変数を外しstdinを閉じる', async () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'NEO_TEST_DUMMY';
    try {
        const output = await execute({ bin: process.execPath, prefix: [] }, ['-e', "process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({apiPresent:!!process.env.OPENAI_API_KEY,stdinEnded:true})))"], process.cwd(), undefined, undefined, undefined, 3000);
        assert.deepEqual(JSON.parse(output), { apiPresent: false, stdinEnded: true });
    }
    finally {
        if (previous === undefined)
            delete process.env.OPENAI_API_KEY;
        else
            process.env.OPENAI_API_KEY = previous;
    }
});
test('既に中断済みならCLIを起動しない', async () => {
    const controller = new AbortController();
    controller.abort();
    let started = false;
    await assert.rejects(() => execute({ bin: process.execPath, prefix: [] }, ['-e', 'setInterval(()=>{},1000)'], process.cwd(), undefined, () => { started = true; }, controller.signal), /中断しました/);
    assert.equal(started, false);
});
test('中断時はWindowsのtree終了が拒否されても自分の子プロセスを止める', async () => { const controller = new AbortController(); let child: import('node:child_process').ChildProcess | undefined; await assert.rejects(() => execute({ bin: process.execPath, prefix: [] }, ['-e', 'setInterval(()=>{},1000)'], process.cwd(), undefined, c => { child = c; setTimeout(() => controller.abort(), 40); }, controller.signal, 15000), /中断しました/); assert.ok(child?.exitCode !== null || child?.signalCode !== null); });
