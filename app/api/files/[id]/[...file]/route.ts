import fs from 'node:fs/promises';
import { safeFile } from '../../../../../server/store';
import { guard, json } from '../../../../../server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: {
    params: Promise<{
        id: string;
        file: string[];
    }>;
}) {
    try {
        guard(req);
        const { id, file } = await params;
        const p = await safeFile(id, file);
        const ext = p.split('.').pop();
        const preview = new URL(req.url).searchParams.has('preview');
        const html = ext === 'html';
        const type = html ? 'text/html; charset=utf-8' : ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : ext === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'text/plain; charset=utf-8';
        return new Response(await fs.readFile(p), { headers: { 'Content-Type': type, 'Content-Disposition': preview ? 'inline' : 'attachment; filename="' + encodeURIComponent(file.at(-1)!) + '"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': html ? "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'" : "default-src 'none'" } });
    }
    catch (e) {
        return json({ error: String(e) }, 404);
    }
}
