# 参考UI：DiscoverButton（「作成する」ボタン用）

2026-11-08 ユーザーが貼り付けたコード（原文のまま）。スライドを「作成する」ボタンのUIはこの仕様にする（ユーザー指示）。出典は draggable-marquee と同じ Obsidian UI（obsidianui.dev）の `components/block` とみられる。コンポーネント本体（`@/components/block/discover-button`）は含まれていない。

## ライセンスと動き（2026-11-08 公式サイトで確認）

- ObsidianUI はMITライセンス（サイトのトップと利用規約5章。GitHubのLICENSEファイル本体は未確認）。無料。使う時はMITの著作権表示を残す
- 見た目：丸いピル型のボタン。文字の左に丸い矢印アイコン。カーソルを合わせる／キーボードで選ぶと、左から暗い塗りが広がり、矢印が右へ7px動き、文字が白になる。表示時に0.5秒でふわっと出る。「動きを減らす」設定では動かない
- 依存：clsx・lucide-react・tailwind-merge。導入は `npx shadcn@latest add "https://www.obsidianui.dev/r/discover-button.json"`
- 出典：https://obsidianui.dev/markdown/docs/discover-button.md

```tsx
import { DiscoverButton } from '@/components/block/discover-button'

export function Demo() {
return <DiscoverButton href="/components" />
}
```
