import fs from 'node:fs/promises';
import path from 'node:path';

export const FIT_MARKER = 'id="neo-slide-fit"';

const FIT = `
<style ${FIT_MARKER}>
@media screen {
    html { overflow-x: hidden; scrollbar-width: none; }
    body {
        width: 1920px !important;
        max-width: none !important;
        margin: 0 auto !important;
        padding: 0 !important;
        zoom: var(--neo-slide-zoom, 1) !important;
    }
}
</style>
<script>
(() => {
    const fit = () => document.documentElement.style.setProperty(
        '--neo-slide-zoom', String(Math.min(window.innerWidth / 1920, window.innerHeight / 1080))
    );
    fit();
    window.addEventListener('resize', fit);
})();
</script>
`;

export function addFit(html: string): string {
    if (html.includes(FIT_MARKER)) return html;
    const end = /<\/body\s*>/i.exec(html);
    return end ? html.slice(0, end.index) + FIT + html.slice(end.index) : html + FIT;
}

export async function fitHtmlFile(dir: string, motion = false): Promise<void> {
    if (motion) return;
    const file = path.join(dir, 'index.html');
    let html: string;
    try { html = await fs.readFile(file, 'utf8'); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
    }
    const fitted = addFit(html);
    if (fitted !== html) await fs.writeFile(file, fitted, 'utf8');
}
