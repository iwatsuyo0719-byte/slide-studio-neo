import { timingSafeEqual, randomBytes } from 'node:crypto';
const g = globalThis as typeof globalThis & {
    neoToken?: string;
};
export const token = g.neoToken ??= randomBytes(32).toString('hex');
export function guard(req: Request, mutate = false) {
    const url = new URL(req.url);
    const rawHost = req.headers.get('host');
    const host = rawHost ? new URL('http://' + rawHost).hostname : '';
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host))
        throw Error('ローカル接続だけ利用できます');
    const origin = req.headers.get('origin');
    if (origin && new URL(origin).host !== url.host)
        throw Error('別のサイトからは操作できません');
    if (req.headers.get('sec-fetch-site') === 'cross-site')
        throw Error('別のサイトからは操作できません');
    if (mutate) {
        const v = req.headers.get('x-neo-token') || '';
        if (v.length !== token.length || !timingSafeEqual(Buffer.from(v), Buffer.from(token)))
            throw Error('画面を再読み込みしてください');
    }
}
export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
