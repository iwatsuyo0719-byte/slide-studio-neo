# SLIDE STUDIO NEO

素材を貼り付け、読み手・出力・目的・レベル・配色を選んで、ローカルの Claude Code / Codex CLI からスライドや議事録を作る Web アプリです。TOP の同じページ内で入力・生成中・質問・設計図確認・完了を切り替えます。

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

偽AIの素材に `[long]` を入れると長い議事録を作り、PDFが作成できた場合は4枚として短縮経路を再現します。`[shorten-ok]` も入れると経緯を短くし、作り直したPDFの実枚数を使います。`[review-error]` でCodexレビュー失敗→Claude Codeへ切り替え、`[review-both-error]` で両レビュー失敗→手直しを省略して完了する経路を再現できます（議事録・詳細スライド共通）。

目的は「提案・報告・説明・研修・議事録」の順です（説明・研修は1つの選択肢）。議事録は出力形式が「Markdown＋PDF（固定）」、レベルが「詳細・止まらず完成まで（固定）」になり、配色は使いません。台帳→議事録→自己検査→新しく起動したCodexのread-onlyレビュー→1周の手直し→PDFまで自動で進みます。目安は約15〜25分（仮）です。台帳は完了画面の「台帳を読む」から確認できます。PDFにはPCのChromeかEdgeを使います。見つからない時はMarkdownだけで完了し、画面に案内を出します。NEO_BROWSER にブラウザ実行ファイルのパスを指定でき、NEO_BROWSER=none でPDFなしの動作を確認できます。

議事録の本文は1時間の会議で約2,500字（A4 2〜3枚）を目安に指示します。生成の最後にPDFを数え、3枚を超えたら最新の minutes.md の論点と経緯を1回だけ短縮します。決定事項・宿題・未確認事項は削らない指示です。短縮後も3枚を超える場合は止めず、画面とログに枚数を表示します。完了後の手動保存・AI修正では枚数の更新だけを行い、自動短縮しません。PDFを作れない場合は枚数確認を省略します。

完了画面の「表示／編集」で議事録のMarkdownを直接編集できます。「保存してPDFを作り直す」で正本を保存し、PDFを再作成します。PDFを作れない場合もMarkdownを保存して理由を表示し、古いPDFは配布しません。保存は50万文字までで、生成中や他の処理中には行えません。AIへの直し指示（1周）も使え、手動保存とAIの直しはどちらを先にしても最新の保存済み minutes.md を元にします。旧版の台帳確認待ちは「OKで本番へ」で続けられます。

## 設定・保存

- 作業場所の既定値は Windows では `%LOCALAPPDATA%\slide-studio-neo`、それ以外では `$XDG_DATA_HOME/slide-studio-neo`（未設定なら `~/.local/share/slide-studio-neo`）です。環境変数 `NEO_WORKSPACE` で変更でき、相対パスはサーバー起動時の作業ディレクトリ（process.cwd()）から解決します。
- 作業場所の中に settings.json、requests/YYYY-MM-DD-題名-ID/、history.json（偽AIは history.fake.json）を保存します。
- 旧版で作った依頼は repo の workspace/requests/ にあります。自動移行はしないため、必要なら新しい場所の requests/ へ手で移してください。
- 各依頼には request.md（5行＋版・配色）、material.md、attachments/、design.md、成果物（slides.pptx / index.html）、check.md、review.md（詳細だけ）、revision.md、run.log、state.json が残ります。議事録では design.md の代わりに ledger.md、成果物は minutes.md と minutes.pdf（作成できる場合）です。
- スライドは、簡易は設計図で止めず制作・自己検査。詳細は設計図承認後に制作・自己検査・別起動のCodexレビュー・作ったAIによる1周の手直し。Codexが利用できない場合と実行中に失敗した場合は、新しく起動したread-onlyのClaude Codeへ代替し、Codexレビュー未実施を記録します。両方失敗した場合もレビューなし・手直し省略で完了し、その旨を表示します。ユーザーの中断時は切り替えません。
- スライドの詳細版の設計図は右端パネルで確認します。×で畳むとつまみから再表示できます。おまかせ配色では3組から選びます。
- 停止・失敗時もファイルを残します。「同じAIで再開」「もう一方のAIで続ける」は手動操作です。サーバー再起動後は履歴で停止扱いにし、同じモードで再開できます。偽AIの依頼を実CLIで再開することは拒否します。
- 設定のAI・モデル・深さは保存した既定値です。上部の札では依頼だけ変更できます。深さの自動は簡易 medium / 詳細 high。モデル候補・下限は設定ファイルにあり、画面・サーバーの両方で品質下限を確認します。レビューの下限は high です。
- 貼り付けは50万文字まで。添付は20件・合計50MBまで（txt / md / docx / pdf / xlsx / csv / pptx / png / jpg / jpeg / webp）。長い素材はファイルを添付してください。

## 実行・保護の仕組み

CLIは依頼フォルダをcwdにして、シェルを挟まず引数配列で起動し、stdinを閉じます。Windowsのnpm用.cmdは対応するNodeエントリポイントを起動します。ANTHROPIC_API_KEY / OPENAI_API_KEY / CODEX_API_KEY / ANTHROPIC_AUTH_TOKEN は大文字小文字にかかわらず子プロセスの環境から外します。CLIのヘルプ・ログイン状態確認も同じ環境で行います。

Codexは制作 workspace-write / レビュー read-only。ClaudeはdontAskと許可ツールのパスを絞り、Pythonはスライド制作時に依頼フォルダの build_slides.py だけを許可します。議事録制作ではBashを許可せず、Read・Write・Editだけを渡します。Claudeのツール制限はOSのファイル隔離と同一ではないため、独立したClaudeのセキュリティレビュー対象です。共通CLI設定や認証情報を書き換えません。

HTTP APIはローカルHost・Originと画面用トークンを検証します。素材と添付は命令として扱わないようCLIへ指示します。生成HTMLはスクリプトだけ許した隔離iframeで表示し、同一オリジン権限・通信・外部リソース・フォーム送信を制限します。成果物の配信は名前の許可リストと実パスで確認します。

## 配色・動き・目安

references/palettes/PALETTES_100.md を直接解析し、100組・4系統・既定026を読み込みます。先頭はおまかせ、末尾はブランドHEXです。横ドラッグ・減速・ホバー停止・左右キーと、prefers-reduced-motion の通常横スクロールに対応します。

GSAPは optional dependency です。入っていればGSAPのtickerを使用し、取得できない環境では同じ移動計算をrequestAnimationFrameで動かします。独自の慣性計算を使い、Draggable / InertiaPlugin のソースは取り込んでいません。Google Fontsを読めない場合も日本語ラベルとシステムフォントで操作できます。

目安はAI・モデル・深さ・版・出力形式別の実績中央値（3件以上）を使用し、それまでは要件の初期値を使います。偽AIの画面では、短いテスト待機時間を生成時間と誤認しないよう常に初期値を使います。スライドの詳細は設計図／本番の2つのメーター。議事録は保存→台帳→議事録→検査→レビュー→手直しの連続したメーターです。確認待ちでは経過を止め、設計図完了と表示し、メーターは99%に保持します。100%は成果物完成時だけにする指示を優先したため、モックの確認待ち100%から変更しています。目安を過ぎた段階は上限の手前で止めます。

## テスト

~~~powershell
npm run lint
npm test
~~~

lint は TypeScript の型検査です。単体・段階実行テストは偽AIを使い、実CLIの生成を呼びません。テスト実行時は NEO_WORKSPACE を os.tmpdir() 配下の一時フォルダに切り替え、利用者の作業場所を汚しません。

HTTPとブラウザのテストは、別ターミナルで次の偽AIサーバーを起動してから実行します。

~~~powershell
$env:NEO_FAKE_AI = "1"
$env:NEO_FAKE_DELAY_MS = "180"
npm run dev -- --port 3210
~~~

~~~powershell
npm run test:http
npm run test:browser
npm run test:e2e
~~~

ブラウザテストはインストール済みChromeの独立したヘッドレスプロファイルを test-results/ 配下に作って使います。必要なら CHROME_PATH と NEO_TEST_URL を設定してください。成功時の画像は test-results/verification/ に保存します。実際のChromeセッション・プロファイルを操作しません。

制限付きのWindowsテストアカウントでChromeのレンダラーが起動せず `Page.enable` がタイムアウトする場合は、テスト実行側だけ `$env:NEO_TEST_NO_SANDBOX = "1"` を指定できます。単体のPDFテストとブラウザテストで起動する独立Chromeにだけ適用されます。ブラウザを自動検出できない場合は `$env:NEO_BROWSER = "C:/Program Files/Google/Chrome/Application/chrome.exe"` も指定してください。アプリ本体のPDF起動引数、iframeのsandbox、テストの判定は変えません。偽AIサーバーのPDF印刷もこの制限で失敗する場合は、サーバー起動側にも `NEO_TEST_NO_SANDBOX=1` を設定し、`$env:NODE_OPTIONS = "--import=./tests/pdf-browser-hook.mjs"` を付けてから上記のdevコマンドを実行してください。このフックは偽AIかつ明示的なテスト設定時のPDF印刷だけに適用されます。テスト後は追加した環境変数を解除してください。

ライセンス: MIT（[LICENSE](LICENSE)）。第三者ライブラリの扱いは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。制作規則の読む順は [prompts/README.md](prompts/README.md)。
