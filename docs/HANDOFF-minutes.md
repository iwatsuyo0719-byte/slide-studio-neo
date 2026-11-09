# HANDOFF — 議事録機能（branch `claude/minutes-a821aa`、WIP）

2026-11-09 notePCで中断。ユーザー判断「A 止めてpushして」により、実装中のCodexを途中で止めてそのままpushした。自宅PCで続ける。

## 済んだこと

- 要件（b681f63）と議事録プロンプト（b19ae9f）を読み、実装範囲をユーザーに確認した
  - Markdown→HTML変換は自前の小さな変換（依存追加なし）
  - 実CLI確認の素材は架空の会議の文字起こし（AIが作成）
  - 実CLI確認は Codex gpt-6.1-sol・簡易で1件
- Codex（gpt-6.1-sol / high / workspace-write）へ委譲した。指示文：[samples/codex-minutes-instruction.md](samples/codex-minutes-instruction.md)
- 約1時間40分動いたところで停止した（終了報告は出ていない）

## 途中で止めたこと

### Codexが書いた分（自己申告なし。完了報告の前に止めたため）

変更・追加されたファイル：`lib/domain.ts`、`lib/markdown.ts`（新規）、`server/runner.ts`、`server/store.ts`、`server/fake.ts`、`server/pdf.ts`（新規）、`app/api/files/[id]/[...file]/route.ts`、`components/Studio.tsx`、`components/PalettePanel.tsx`、`app/globals.css`、`tests/domain.test.ts`、`tests/workflow.test.ts`、`tests/browser.e2e.ts`、`tests/markdown.test.ts`（新規）、`tests/pdf.test.ts`（新規）、`README.md`、`STATUS.md`

停止直前のログでは、ブラウザテスト（議事録の詳細：台帳表示→OKで本番へ→議事録表示）とREADMEへの追記を書き、`npm run lint` が通ったところだった。

### Claudeが確かめた結果

- `npm test`（単体）：30件すべて通過（停止後に実行）
- `npm run lint`：Codexのログ上は通過。Claudeは再実行していない（未確認）
- `npm run test:e2e`（HTTP・ブラウザ）：未実行
- 差分の中身のレビュー：未実施。指示文の各項目（特に出力形式の固定表示・配色ロック・PDFの一時ファイル削除・`.md`/`.pdf`のダウンロード・旧レコード「会議まとめ」の扱い）を満たしているかは未確認
- PalettePanel.tsx は main 側の別スレッドも触っているので、merge時に衝突の可能性あり

## 次にやる手順

1. 自宅PCで `git fetch` → `claude/minutes-a821aa` を取り出し、`npm install`
2. `npm run lint`、`npm test`、`npm run test:e2e` を回し、落ちたら直す（Codexへの差し戻しでよい。指示文の未達分を足す）
3. 別のClaude（Subagent）に差分をレビューさせる。指示文と `docs/REQUIREMENTS.md` の受け入れ条件15〜18を突き合わせる
4. 画面で議事録を選び、出力形式が「Markdown＋PDF（固定）」・配色パネルがロックされることをブラウザで確認
5. 実CLI（Codex gpt-6.1-sol・簡易）で議事録を1件作る。素材は下の架空の文字起こし。`minutes.md` の構成5項目・宿題の表・xx・「」・（未確認）と、`minutes.pdf` の書式（A4縦・本文10.5pt・1〜2枚）を確認
6. STATUS.md を更新し、WIPでない形でcommit・push
7. ユーザーの承認後に main へ merge（勝手にmergeしない）

## 実CLI確認用の架空の文字起こし

[samples/minutes-transcript-sample.md](samples/minutes-transcript-sample.md)（架空の会議。個人情報なし。年末販促の会議で、数値・決定・宿題・未確認になる点を含む）
