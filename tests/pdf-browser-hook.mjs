// Opt-in only for an isolated fake-AI dev server on restricted Windows test accounts.
// Production launch arguments and real-AI sessions are unaffected.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
if (process.env.NEO_FAKE_AI === '1' && process.env.NEO_TEST_NO_SANDBOX === '1') {
    const spawn = childProcess.spawn;
    childProcess.spawn = (bin, args = [], options) => spawn(bin, args.includes('--headless=new') && args.some(arg => arg.startsWith('--print-to-pdf=')) ? [...args, '--no-sandbox'] : args, options);
    syncBuiltinESMExports();
}
