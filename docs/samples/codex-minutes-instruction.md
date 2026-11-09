# 指示：SLIDE STUDIO NEO に「議事録」機能を実装する

作業場所：このworktree（branch `claude/minutes-a821aa`）。node_modules は導入済み。
まず `AGENTS.md`、`docs/REQUIREMENTS.md` の「議事録」節と受け入れ条件15〜18、`DECISIONS.md` の 2026-11-09 の行、`prompts/minutes.md`、`prompts/README.md` を読むこと。仕様の正本はそれら。Next.js はこのrepoの版に破壊的変更があるので、Next の API を新しく使う時は `node_modules/next/dist/docs/` を確認する。

## 目的
目的（資料の種類）の「会議まとめ」を「議事録」に置き換え、議事録を選ぶとスライドではなく議事録の文書（`minutes.md` が正本、配布用 `minutes.pdf`）を作れるようにする。

## 実装内容

### 1. lib/domain.ts
- `Purpose` の `'会議まとめ'` を `'議事録'` に。`purposes['議事録']` の goal/structure は要件の表の行に合わせる（冒頭情報→決定事項→宿題→論点と経緯→次回の確認事項。meeting.md と minutes.md を読む）。
- 目的が議事録の時、`formats` は検証で受け付けたうえで無視してよいが、レコード上は分かる形にする（例：`isMinutes(input)` ヘルパーを作り各所で使う）。`validateInput` は議事録なら palette/brand のチェックをしない（配色は使わない）。
- 旧レコード（purpose が '会議まとめ'）を読み込んでも落ちないこと（一覧表示できればよい。読む時に '議事録' に読み替えるか、表示だけそのまま出す。どちらかに決めてコメント1行）。
- `requestText`：議事録の時は「出力：議事録 minutes.md（Markdown正本）。PDFはツールが作る」とし、配色行は出さないか「配色：使わない（議事録）」。「何を」の既定文言も議事録向けに（素材から会議名を決めて議事録を作る）。
- `estimate`：議事録の目安（仮）を要件どおり：簡易 約8〜15分（設計図＋本番まとめて。設計図 phase は [2,5]、production は [6,10] 程度で合計が8〜15に収まるように）、詳細 台帳まで[4,8]・OK後[15,25]。historyKey に議事録が区別されるようにする（formats の代わりに 'minutes'）。
- `progress`：議事録の段階の重みも破綻しないこと。

### 2. server/runner.ts（段取り）
段階名（Stage）はそのまま流用：設計図＝台帳、本番＝議事録、検査、レビュー、手直し。
- 設計図段階（議事録）：AIへの指示で `ledger.md`（台帳）と `decision.json` を作らせる。design.md は作らない。質問 question.json は使わない（minutes.md の「質問で止めない」）。おまかせ配色の候補も作らせない。必須ファイルは `ledger.md`,`decision.json`。
- `r.design` に相当する表示内容として、議事録では ledger.md の中身を画面へ渡す（`store.artifacts` で議事録なら design に ledger.md を入れる、など）。
- 詳細は台帳で止まる（status 'design'）。承認・直し指示（design-feedback.md）は既存の流れのまま使う。直し指示時はAIに ledger.md を直させる。
- 本番（議事録）：ledger.md・approved.md・prompts/minutes.md に従い `minutes.md` を作らせる。必須ファイル `minutes.md`。
- 検査：minutes.md の自己検査を check.md へ（要件「自己検査」の6項目）。
- レビュー（詳細のみ）：Codexを新しく起動して read-only。観点＝素材との食い違い・決定と宿題の取り違え・経緯の飛躍・未確認の付け忘れ。渡す資料は request.md・material.md・ledger.md・minutes.md・check.md・prompts/meeting.md・prompts/minutes.md。preview画像やスライドの規準は議事録では使わない。
- 手直し：review.md（と final-feedback.md）を読み minutes.md を1周直し、revision.md を書く。
- 議事録の時は protocol の文言を議事録用に切り替える（スライド・pptx・HTML・preview・配色の指示を混ぜない）。「これはスライドを作る作業」とある部分も議事録なら「議事録を作る作業」に。
- 完了の直前（簡易は検査後、詳細は手直し後、完了後の直し revise の後も）に PDF を作る：新モジュール `server/pdf.ts`。
  - `minutes.md` を自前の小さなMarkdown→HTML変換（下記3）で印刷用HTMLにし、OSの一時フォルダ（`os.tmpdir()` 下の一意なフォルダ）に書き、PCの Chrome（無ければ Edge）を `--headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf=<依頼フォルダ>/minutes.pdf` などで起動して印刷する。一時HTMLとプロファイル用一時フォルダは必ず削除（finally）。依頼フォルダに途中のHTMLを残さない。`--user-data-dir` は一時フォルダにする。タイムアウト60秒、ジョブの中断(AbortSignal)に従う（既存 `execute` を使ってよい）。
  - ブラウザ探索：環境変数 `NEO_BROWSER` があればそれ。Windowsは `%ProgramFiles%`,`%ProgramFiles(x86)%`,`%LOCALAPPDATA%` 配下の `Google/Chrome/Application/chrome.exe` と `Microsoft/Edge/Application/msedge.exe`。macOS/Linux も代表的な場所と PATH（google-chrome, chromium, microsoft-edge）を探す。新しいソフトは入れない。
  - 見つからない／失敗した時は止めずに完了扱いにし、ログと画面に「PDFは作れませんでした（Chrome か Edge が必要）」を1行出す（RecordData に `pdfNote?: string` など）。
  - 偽AIモード（NEO_FAKE_AI=1）でもブラウザがあれば実際に印刷してよい。テストを安定させるため `NEO_BROWSER=none` でブラウザ無しの経路を強制できるようにする。
- 議事録では `previews()`（LibreOffice）を呼ばない。
- `store.artifacts`：議事録の成果物として `minutes.md`,`minutes.pdf`,`ledger.md` を files に載せる（ダウンロード用）。
- 印刷用CSS（書式はユーザーFIX、変えないこと）：`@page { size: A4 portrait; margin: 25mm 20mm; }`、表題 h1 16pt 太字、見出し h2/h3 13pt 太字、本文・箇条 10.5pt line-height 1.6、表 10pt（罫線あり、ヘッダー薄い背景）、注・「（未確認）」の印・ページ番号 9pt、フォントは `"Yu Gothic", "YuGothic", "游ゴシック", "Hiragino Sans", "Noto Sans JP", sans-serif`。ページ番号は Chrome の header/footer を使わず、可能なら CSS（@page の margin box は Chrome 131+ で効く。効かなくても可）。「（未確認）」「未確認」の文字列は小さい印として span で 9pt にしてよい。

### 3. Markdown→HTML変換（自前・依存追加なし）`lib/markdown.ts`
- 対応：# 〜 ###、段落、箇条（- と 1.、1段の入れ子まで）、表（| 区切り・2行目が区切り行）、**太字**、`コード`、> 引用、水平線。
- 文字は必ずHTMLエスケープしてから装飾を付ける（XSS対策。リンクは作らない／生HTMLは通さない）。
- 画面の完了表示とPDFの両方で使う。単体テストを付ける（表・エスケープ・箇条）。

### 4. 画面 components/Studio.tsx（＋必要なら PalettePanel.tsx・globals.css）
- 目的の選択肢を「議事録」に（アイコンは Material Symbols の適当なもの、例 `description` / `edit_note`）。
- 議事録を選ぶと：出力形式欄は選択肢の代わりに「Markdown＋PDF（固定）」の表示になり選べない。配色パネルは薄く（opacity等）して操作不可（`aria-disabled`、tabIndex=-1、クリック・ホバーのポップアップも出さない）。理由を短く添える（「議事録では配色を使いません」）。読み手・レベル・AI選択はそのまま使える。
- 詳細の確認待ち：右端パネルに台帳（ledger.md）を表示（見出しは「台帳の確認」などに）。ボタン文言は既存の「OKで本番へ」「直し指示」を流用でよい。配色候補UIは出さない。
- 完了：`minutes.md` を3の変換で読める形で表示し、「Markdownをダウンロード」「PDFをダウンロード」（PDFが無ければボタンを出さず pdfNote を表示）「フォルダを開く」を出す。スライド用のプレビュー（iframe・画像）は議事録では出さない。
- PalettePanel.tsx は別スレッドが並行で触っているので、`disabled` の受け渡しなど最小限の変更に留める。

### 5. ダウンロード
- `app/api/files/[id]/[...file]/route.ts` で `.md` を `text/markdown; charset=utf-8`、`.pdf` を `application/pdf` で返し、ダウンロード用に `Content-Disposition: attachment`（`?download=1` の時など、既存の作りに合わせる）。既存のパス検証（依頼フォルダの外を読めない）を壊さない。

### 6. 偽AI server/fake.ts
- 議事録の時：設計図で ledger.md と decision.json、本番で minutes.md（構成5項目・宿題の表・「」の引用・xx・（未確認）・末尾の未確認事項を含む見本）、検査で check.md、レビューで review.md、手直しで revision.md と minutes.md 更新。

### 7. テスト（tests/）
- domain：議事録の validateInput（配色を見ない）、requestText、historyKey/estimate。
- markdown：変換とエスケープ。
- workflow（偽AI）：議事録・簡易で止まらず minutes.md ができ done になる（NEO_BROWSER=none で pdfNote が出る）。議事録・詳細で status 'design' で止まり、design に台帳の中身、approve でレビュー→手直しまで進む。
- pdf：Chrome/Edge が見つかる環境では minutes.pdf ができ先頭が `%PDF` であることを確かめるテスト（見つからない環境では skip）。一時HTMLが依頼フォルダに残らないことも確かめる。
- browser.e2e：議事録を選ぶと出力形式が固定表示・配色パネルが操作不可になる、完了でMarkdown表示とダウンロードボタンが出る。既存テストの書き方に合わせる。
- `npm run lint`、`npm test`、`npm run test:e2e` が全部通ること。

### 8. 文書
- `STATUS.md` に1行（議事録機能を実装、実CLI確認は未）を追記。`README.md` に目的の種類の記述があれば「議事録」に合わせる。

## 変更禁止
- `prompts/` 配下（minutes.md・meeting.md・README.md 含む）は読むだけ。書式の値（上記CSS）を変えない。
- `~/.codex/AGENTS.md`、設定ファイル、repo外のファイル。
- 依存パッケージの追加（package.json の dependencies を増やさない）。
- 提案・報告・説明・研修の既存の流れ（スライド生成）を壊さない。
- git commit / push はしない（Claude が確認してから行う）。

## 完了条件
受け入れ条件15〜18（REQUIREMENTS.md）を偽AIとテストで満たし、lint・単体・e2e が通る。完了報告に、変更ファイル一覧／自己監査（確認したこと・直したこと・未確認）／テスト結果の要約を書く。
