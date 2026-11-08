# 参考UI：DraggableMarquee（配色パネル用）

2026-11-08 ユーザーが貼り付けたコード（原文のまま）。出典は Obsidian UI（obsidianui.dev）とみられる。**ライセンスと、画像CDN（cdn-new.obsidianui.dev）の利用条件は未確認。** 公開repoで使う前に確かめる。コンポーネント本体（`@/components/block/draggable-marquee`）は含まれていない。

```tsx
"use client";
import { DraggableMarquee } from "@/components/block/draggable-marquee";

const items = [
  { "id": 1, "src": "https://cdn-new.obsidianui.dev/imagess/1.png", "alt": "Landscape photograph 1", "width": 420, "height": 520, "imageClassName": "h-[260px] w-[200px] rounded-2xl object-cover" },
  { "id": 2, "src": "https://cdn-new.obsidianui.dev/imagess/2.png", "alt": "Landscape photograph 2", "width": 420, "height": 520, "imageClassName": "h-[260px] w-[200px] rounded-2xl object-cover" },
  { "id": 3, "src": "https://cdn-new.obsidianui.dev/imagess/3.png", "alt": "Landscape photograph 3", "width": 420, "height": 520, "imageClassName": "h-[260px] w-[200px] rounded-2xl object-cover" },
  { "id": 4, "src": "https://cdn-new.obsidianui.dev/imagess/4.png", "alt": "Landscape photograph 4", "width": 420, "height": 520, "imageClassName": "h-[260px] w-[200px] rounded-2xl object-cover" }
];

export default function Demo() {
  return <DraggableMarquee items={items} speed={1} className="py-8" />;
}
```
