# SLIDE STUDIO NEO

素材を貼り付け、読み手・出力・目的・レベル・配色を選んで、ローカルの Claude Code / Codex CLI からスライドを作る Web アプリです。TOP の同じページ内で入力・生成中・質問・設計図確認・完了を切り替えます。

## 必要なもの・起動

- Node.js 20.9 以上（検証環境は Windows / Node.js 24.22.1）と npm。
- Claude Code または Codex CLI。PATH に通し、**サブスクでログイン**してください。APIキーの入力欄はありません。CLI の存在・サブスク認証状態は設定の「CLIを再確認」で更新できます。
- 正本の制作規則はこのrepoの prompts/ です。姉妹repoのインストール・書き換えは不要です。
- pptx の実制作には、CLI が使える Python と python-pptx が必要です。画像プレビューは任意の LibreOffice、全ページの画像化には追加で Poppler の pdftoppm を PATH に置いてください。LibreOffice だけなら先頭ページを画像化します。どちらも無い場合も pptx をダウンロードできます。

repo のルートで実行します。

~~~powershell
npm install
npm run dev
~~~

起動後に http://127.0.0.1:3000 をブラウザで開きます。インストール後の起動は npm run dev の1コマンドです。外部公開は想定しておらず、サーバーはループバックアドレスにだけバインドします。

本番ビルドを使う場合:

~~~powershell
npm run build
npm start
~~~

## 偽AIで動作確認

実CLIの生成は呼び出しません。実AIでの生成検証とは区別してください。

~~~powershell
$env:NEO_FAKE_AI = "1"
npm run dev
~~~

素材に [question] を含めると質問、[error] を含めると本番の段階でエラーになります。「もう一方のAIで続ける」で保存済みの段階から進みます。AUTO は偽AIでは社外または素材600文字超を詳細、それ以外を簡易にする固定の判定です。実運用では作るAIが判断し、選んだ版と理由を返します。既定の段階待機は1秒、NEO_FAKE_DELAY_MS で変更できます。偽AIのpptx・検査・レビューは動作確認用で、資料品質の検証結果ではありません。

## 設定・保存

- 設定は workspace/settings.json、依頼は workspace/requests/YYYY-MM-DD-題名-ID/、実績は workspace/history.json（偽AIは history.fake.json）に保存します。すべて Git の対象外です。
- 各依頼には request.md（5行＋版・配色）、material.md、attachments/、design.md、成果物（slides.pptx / index.html）、check.md、review.md（詳細だけ）、revision.md、run.log、state.json が残ります。
- 簡易は設計図で止めず制作・自己検査。詳細は設計図承認後に制作・自己検査・別起動のCodexレビュー・作ったAIによる1周の手直し。Codexが利用できない場合だけClaudeへ代替し、Codexレビュー未実施を記録します。
- 詳細版の設計図は右端パネルで確認します。×で畳むとつまみから再表示できます。おまかせ配色では3組から選びます。
- 停止・失敗時もファイルを残します。「同じAIで再開」「もう一方のAIで続ける」は手動操作です。サーバー再起動後は履歴で停止扱いにし、同じモードで再開できます。偽AIの依頼を実CLIで再開することは拒否します。
- 設定のAI・モデル・深さは保存した既定値です。上部の札では依頼だけ変更できます。深さの自動は簡易 medium / 詳細 high。モデル候補・下限は設定ファイルにあり、画面・サーバーの両方で品質下限を確認します。レビューの下限は high です。
- 貼り付けは50万文字まで。添付は20件・合計50MBまで（txt / md / docx / pdf / xlsx / csv / pptx / png / jpg / jpeg / webp）。長い素材はファイルを添付してください。

## 実行・保護の仕組み

CLIは依頼フォルダをcwdにして、シェルを挟まず引数配列で起動し、stdinを閉じます。Windowsのnpm用.cmdは対応するNodeエントリポイントを起動します。ANTHROPIC_API_KEY / OPENAI_API_KEY / CODEX_API_KEY / ANTHROPIC_AUTH_TOKEN は大文字小文字にかかわらず子プロセスの環境から外します。CLIのヘルプ・ログイン状態確認も同じ環境で行います。

Codexは制作 workspace-write / レビュー read-only。ClaudeはdontAskと許可ツールのパスを絞り、Pythonは依頼フォルダの build_slides.py だけを許可します。Claudeのツール制限はOSのファイル隔離と同一ではないため、独立したClaudeのセキュリティレビュー対象です。共通CLI設定や認証情報を書き換えません。

HTTP APIはローカルHost・Originと画面用トークンを検証します。素材と添付は命令として扱わないようCLIへ指示します。生成HTMLはスクリプトだけ許した隔離iframeで表示し、同一オリジン権限・通信・外部リソース・フォーム送信を制限します。成果物の配信は名前の許可リストと実パスで確認します。

## 配色・動き・目安

references/palettes/PALETTES_100.md を直接解析し、100組・4系統・既定026を読み込みます。先頭はおまかせ、末尾はブランドHEXです。横ドラッグ・減速・ホバー停止・左右キーと、prefers-reduced-motion の通常横スクロールに対応します。

GSAPは optional dependency です。入っていればGSAPのtickerを使用し、取得できない環境では同じ移動計算をrequestAnimationFrameで動かします。独自の慣性計算を使い、Draggable / InertiaPlugin のソースは取り込んでいません。Google Fontsを読めない場合も日本語ラベルとシステムフォントで操作できます。

目安はAI・モデル・深さ・版・出力形式別の実績中央値（3件以上）を使用し、それまでは要件の初期値を使います。詳細は設計図／本番の2つのメーター。確認待ちでは経過を止め、設計図完了と表示し、メーターは99%に保持します。100%は成果物完成時だけにする指示を優先したため、モックの確認待ち100%から変更しています。目安を過ぎた段階は上限の手前で止めます。

## テスト

~~~powershell
npm run lint
npm test
~~~

lint は TypeScript の型検査です。単体・段階実行テストは偽AIを使い、実CLIの生成を呼びません。テスト用の依頼は workspace/ に残します。

HTTPとブラウザのテストは、別ターミナルで次の偽AIサーバーを起動してから実行します。

~~~powershell
$env:NEO_FAKE_AI = "1"
$env:NEO_FAKE_DELAY_MS = "180"
npm run dev -- --port 3210
~~~

~~~powershell
npm run test:http
npm run test:browser
~~~

ブラウザテストはインストール済みChromeの独立したヘッドレスプロファイルを使います。必要なら CHROME_PATH と NEO_TEST_URL を設定してください。成功時の画像は workspace/verification/ に保存します。実際のChromeセッション・プロファイルを操作しません。

## 検証記録（2026-11-08）

この環境では直接のGitHub/npm接続が拒否されたため、既存npmキャッシュをrepo内のGit対象外 .npm-cache/ に必要な分だけコピーしてインストールしました。GSAPはキャッシュに無く、この環境では代替の慣性計算を使用します。通常のオンラインnpm取得とGSAP実動作は未確認です。

確認済み: オフラインキャッシュでの npm install、npm run build、npm run lint、npm test（16件）、npm run test:http（1件）。npm run test:browser は下記の環境制約で未完了です。

要件8章の受け入れ条件との対応:

| 条件 | 結果 |
|---|---|
| 1 起動・TOP・1280×720 | 開発サーバー起動とTOPのHTTP 200を確認。画面寸法の実測は未確認 |
| 2 設定・品質下限・CLI・環境除去 | 型・単体テスト、CLIヘルプと両CLIのサブスク認証状態を確認。設定の画面操作・実生成時のCLI権限制約は未確認 |
| 3 選択→依頼・素材保存 | 目的4種の依頼文、素材・添付、HTTP経由の保存を確認 |
| 4 簡易→成果物 | 偽AIでHTML・検査、詳細のpptx生成ファイルを確認。ブラウザのプレビュー・ダウンロード操作は未確認 |
| 5 詳細→設計図停止・修正・OK・レビュー | 段階実行テストとHTTPで確認。パネルの画面操作は未確認 |
| 6 AUTOの版・理由 | 偽AIの簡易／詳細分岐と理由を確認。実AIの判断は未確認 |
| 7 配色パネル | 原本100組・4系統・026・HEX検証を確認。ドラッグ・慣性・ホバー・左右キー・動きを減らす設定の実操作は未確認 |
| 8 DiscoverButton | 実装済み。ホバー／フォーカスの見た目は未確認 |
| 9 履歴 | API一覧・再読込を確認。画面からの再表示は未確認 |
| 10 repoの機密・成果物除外 | Git状態・追跡ファイル・禁止範囲の差分を最終監査で確認 |
| 11 元の段取りとの一致 | 偽AIで簡易・詳細・質問・停止・再開・1周の直しを確認。実AIとの作り比べは未確認 |
| 12 時間目安・進捗 | 中央値・初期値・段階の重み・超過・完了だけ100%をテスト。画面実測は未確認 |
| 13 AI設定の作り比べ | 今回は実CLI生成禁止のため未実施 |
| 14 独自プロンプトの品質 | 今回の変更対象外。既存の承認記録は docs/REQUIREMENTS.md 6b を参照 |

ヘッドレスChromeはDevTools接続・対象タブの作成まで成功しましたが、Page.enable が10秒でタイムアウトしました。GPU無効化でも同じ結果のため、ブラウザ検証は環境制約で未完了です。成功したと扱っていません。LibreOfficeでの画像化、実資料品質、モデルの対応深さ・利用上限・実CLIの中断／再開も未確認です。

ライセンス: MIT（[LICENSE](LICENSE)）。第三者ライブラリの扱いは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。制作規則の読む順は [prompts/README.md](prompts/README.md)。
