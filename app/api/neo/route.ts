import path from 'node:path';
import { settings, palettes, history, atomic, workspace } from '../../../server/store';
import { token, guard, json } from '../../../server/http';
import { statuses } from '../../../server/cli';
import { create, current, act, list, openFolder } from '../../../server/runner';
import { validateSettings } from '../../../lib/domain';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
    try {
        guard(req);
        const url = new URL(req.url);
        if (url.searchParams.has('id'))
            return json(await current(url.searchParams.get('id')!));
        if (url.searchParams.has('history'))
            return json(await list());
        const [s, p, h, c] = await Promise.all([settings(), palettes(), history(), statuses(url.searchParams.has('refresh'))]);
        return json({ settings: s, palettes: p, history: h, cli: c, token, fake: process.env.NEO_FAKE_AI === '1' });
    }
    catch (e) {
        return json({ error: String(e) }, 400);
    }
}
export async function POST(req: Request) {
    try {
        guard(req, true);
        if (req.headers.get('content-type')?.includes('multipart/form-data')) {
            if (Number(req.headers.get('content-length') || 0) > 52 * 1024 * 1024)
                throw Error('素材は合計50MBまでです');
            const form = await req.formData();
            const input = JSON.parse(String(form.get('input')));
            const files = form.getAll('files').filter((f): f is File => typeof f !== 'string');
            return json(await create(input, files));
        }
        if (Number(req.headers.get('content-length') || 0) > 4 * 1024 * 1024)
            return json({ error: 'JSON本文は4MBまでです' }, 413);
        const body = await req.json();
        if (body.action === 'settings') {
            const s = validateSettings(body.settings);
            await atomic(path.join(workspace, 'settings.json'), s);
            return json(s);
        }
        if (body.action === 'open-folder')
            return json(await openFolder(body.id));
        return json(await act(body.id, body.action, body));
    }
    catch (e) {
        return json({ error: String(e) }, 400);
    }
}
