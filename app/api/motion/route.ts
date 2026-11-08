import fs from 'node:fs/promises';
import path from 'node:path';
import { guard } from '../../../server/http';
export const runtime = 'nodejs';
export async function GET(req: Request) {
    try {
        guard(req);
        const code = await fs.readFile(path.join(process.cwd(), 'node_modules/gsap/dist/gsap.min.js'), 'utf8');
        return new Response(code, { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    }
    catch {
        return new Response('', { status: 200, headers: { 'Content-Type': 'text/javascript' } });
    }
}
