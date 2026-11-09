import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 副作用importをstore/runnerより先に置き、利用者の指定もテスト中は上書きする。
process.env.NEO_WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-test-'));
