# STATUS — SLIDE STUDIO NEO

- 2026-11-08：立ち上げ（フォルダ構成と初期要望のみ）
- 2026-11-08：要件定義 v1.0 をユーザーが承認（`docs/REQUIREMENTS.md`）。画面案は `docs/mockup/index.html`（TOP 1ページ）
- 2026-11-08：Google Fonts 使用可。GitHub公開repo（iwatsuyo0719-byte/slide-studio-neo）を作成
- 2026-11-08：独自プロンプト `prompts/` を作成・検証し原本にした（要件 6b）。追加2規則は作り比べ未実施
- 2026-11-08：LICENSE を MIT にした
- 2026-11-08：v1をCodexが実装（dcf1a3b）。ホバーの動き調整、実CLI起動の不具合修正まで（fb1cb4c）
- 2026-11-09（notePC）：偽AIのテスト一式（単体17・HTTP・ブラウザ）を通るように修正。Windowsで state.json の保存がEPERMになる問題（開発サーバーの監視が原因）、BOM付きJSON、ログイン確認の時間切れ、Codexが開発用ルールで止まる問題を直した
- 2026-11-09：**実CLIで初めて1件完成**（Codex gpt-6.1-sol・簡易・HTML 3ページ）。所要約30分（設計図4分・本番16分・検査10分）で、目安「約5〜8分」を大きく超える。出来は良好（見出し・注・出所あり）
- 残り：①依頼フォルダをrepoの外に出すか（Codexが開発用ルールを読む問題の根本対策）②目安時間の初期値の見直し ③詳細版・pptx・Claude Code（notePCは未ログイン）の実CLI確認 ④受け入れ条件13（作り比べ）
