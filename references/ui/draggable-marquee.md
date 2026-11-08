# 参考UI：DraggableMarquee（配色パネル用）

2026-11-08 ユーザーが貼り付けたコード（原文のまま）。出典は Obsidian UI（obsidianui.dev）とみられる。コンポーネント本体（`@/components/block/draggable-marquee`）は含まれていない。

## ライセンスと動き（2026-11-08 公式サイトで確認）

- コードはMITライセンス・無料（サイトのトップと利用規約5章。GitHubのLICENSEファイル本体は未確認）。使う時はMITの著作権表示を残す
- **見本の画像（cdn-new.obsidianui.dev/imagess/1〜4.png）は再利用の許諾が無い**（利用規約5章：デモ素材は動きを見せるためのもので、自分の素材に差し替える）。このProjectでは画像を使わず、配色カードを自前で描く
- 動き：GSAP＋Draggable で無限ループする横一列。ドラッグでき、離すと慣性で流れて減速する。フォーカス時は左右キーで動く。`pauseOnHover` あり。「動きを減らす」設定では普通の横スクロールになる。依存は gsap（next/image を使う）
- 出典：https://obsidianui.dev/markdown/docs/draggable-marquee.md

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
