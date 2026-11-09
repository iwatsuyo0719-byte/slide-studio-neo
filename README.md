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

目的の「議事録」は Markdown＋PDF（固定）で作り、配色は使いません。詳細版は台帳を確認してから議事録に進みます。PDFにはPCのChromeかEdgeを使います。見つからない時はMarkdownだけで完了し、画面に案内を出します。NEO_BROWSER にブラウザ実行ファイルのパスを指定でき、NEO_BROWSER=none でPDFなしの動作を確認できます。

## 設定・保存

- 作業場所の既定値は Windows では `%LOCALAPPDATA%\slide-studio-neo`、それ以外では `$XDG_DATA_HOME/slide-studio-neo`（未設定なら `~/.local/share/slide-studio-neo`）です。環境変数 `NEO_WORKSPACE` で変更でき、相対パスはサーバー起動時の作業ディレクトリ（process.cwd()）から解決します。
- 作業場所の中に settings.json、requests/YYYY-MM-DD-題名-ID/、history.json（偽AIは history.fake.json）を保存します。
- 旧版で作った依頼は repo の workspace/requests/ にあります。自動移行はしないため、必要なら新しい場所の requests/ へ手で移してください。
- 各依頼には request.md（5行＋版・配色）、material.md、attachments/、design.md、成果物（slides.pptx / index.html）、check.md、review.md（詳細だけ）、revision.md、run.log、state.json が残ります。議事録では design.md の代わりに ledger.md、成果物は minutes.md と minutes.pdf（作成できる場合）です。
- 簡易は設計図で止めず制作・自己検査。詳細は設計図承認後に制作・自己検査・別起動のCodexレビュー・作ったAIによる1周の手直し。Codexが利用できない場合だけClaudeへ代替し、Codexレビュー未実施を記録します。
- 詳細版の設計図は右端パネルで確認します。×で畳むとつまみから再表示できます。おまかせ配色では3組から選びます。
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

目安はAI・モデル・深さ・版・出力形式別の実績中央値（3件以上）を使用し、それまでは要件の初期値を使います。偽AIの画面では、短いテスト待機時間を生成時間と誤認しないよう常に初期値を使います。詳細は設計図／本番の2つのメーター。確認待ちでは経過を止め、設計図完了と表示し、メーターは99%に保持します。100%は成果物完成時だけにする指示を優先したため、モックの確認待ち100%から変更しています。目安を過ぎた段階は上限の手前で止めます。

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

制限付きのWindowsテストアカウントでChromeのレンダラーが起動せず `Page.enable` がタイムアウトする場合は、テスト実行側だけ `$env:NEO_TEST_NO_SANDBOX = "1"` を指定できます。単体のPDFテストとブラウザテストで起動する独立Chromeにだけ適用されます。ブラウザを自動検出できない場合は `$env:NEO_BROWSER = "C:/Program Files/Google/Chrome/Application/chrome.exe"` も指定してください。アプリ本体のPDF起動引数、iframeのsandbox、テストの判定は変えません。

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

## 議事録WIPの仕上げ・照合（2026-11-09）

完了画面の初回描画でpreviewが空、次のeffectでiframeが現れる順序をMutationObserverで確認。完了レコードのfilesから同じ描画内でプレビューを決め、サムネイルの選択だけを依頼ID付きで保持するよう修正しました。元のsandbox判定は維持し、初回描画でのプレビュー欠落も拒否する検査を追加しました。

前回指示（docs/samples/codex-minutes-instruction.md）と着手時の要件・受け入れ条件との照合。満たすはコード・単体・偽AIの確認範囲で、実CLIの生成品質を保証する意味ではありません。

| 指示項目 | 結果・確認内容 |
|---|---|
| 1 Purpose・goal・structure | 満たす：議事録と構成5項目、meeting/minutes規則 |
| 1 formats・palette/brand検証 | 満たす：形式入力は検証後に無視、purposeで文書を判別。配色は検証・使用しない |
| 1 旧「会議まとめ」レコード | 満たす：元のラベルで保持し一覧表示。実装に方針コメントを追記 |
| 1 requestText | 満たす：会議名の既定文・Markdown正本とツールのPDF変換・配色不使用 |
| 1 estimate・historyKey | 直した：簡易2〜5＋6〜10分、詳細4〜8／15〜25分、minutes専用キー。偽AI画面は初期値を維持 |
| 1 progress | 満たす：議事録の重みと段階順、完了前は100%にしない |
| 2 台帳・必須ファイル・質問抑止 | 満たす：ledger.md＋decision.json。design.md・question.json・配色候補を使わない |
| 2 台帳の表示・詳細停止・承認と直し | 満たす：designに台帳を載せ、design状態で停止。feedbackとapproveを段階テストで確認 |
| 2 本番 | 満たす：ledger.md・approved.md・minutes規則に従いminutes.mdを必須にする |
| 2 自己検査 | 満たす：構成順／宿題表／数値／引用／未確認／分量の6項目をcheck.mdへ |
| 2 詳細の独立レビュー | 満たす（コード・引数検査）：新規Codex exec、read-only、指定7資料と4観点。実CLI起動は未確認 |
| 2 手直し・完了後revise | 満たす：review/final-feedbackを使い1周。revision.mdとminutes.mdの更新を確認 |
| 2 議事録専用protocol | 直した：スライド・pptx・HTML・preview・配色の指示なし。ClaudeのBash/build_slides許可も除外 |
| 2 PDF作成の段階 | 満たす：簡易の検査後、詳細の手直し後、完了後revise後に作成。古いPDFを渡さない |
| 2 PDF一時HTML・プロファイル | 満たす：OS一時フォルダに一意の場所を作りfinallyで削除。成功・起動失敗・印刷中の中断で残存なし |
| 2 ブラウザ探索 | 満たす（コード照合）：NEO_BROWSER優先、Chrome→Edge、OS別候補とPATH。macOS/Linux実機は未確認 |
| 2 PDF中断・タイムアウト | 満たす：AbortSignalと60秒の制限。印刷中の中断を実プロセスで確認。60秒の実待機試験は未確認 |
| 2 PDF失敗・none | 満たす：止めずに指定pdfNoteをログ・画面へ。none経路と失敗経路を確認 |
| 2 previews()とfiles | 満たす：議事録はLibreOffice経路を通さず、minutes.md/pdf・ledger.mdを配信対象にする |
| 2 印刷CSS | 直した：FIX値は保持。注記にnote要素を付け9ptを実際に適用。A4縦・余白25/20mm、16/13/10.5/10/9pt・行高1.6・指定フォントを検査 |
| 3 Markdown対応範囲 | 満たす：見出し1〜3、段落、箇条と1段の入れ子、表、太字、コード、引用、水平線 |
| 3 エスケープ・共用・単体 | 満たす：文字を先にエスケープ、生HTML・リンクを生成しない。画面/PDF共用で単体確認 |
| 4 目的・固定形式・入力 | 満たす：議事録とdescription、Markdown＋PDF（固定）。読み手・レベル・AI選択を維持 |
| 4 配色パネルのロック | 直した：理由・薄い表示・aria-disabled。カード/タブ/ブランド入力/領域はtabIndex=-1、クリック・キー操作・ホバーポップアップを抑止 |
| 4 台帳確認UI | 満たす：右端に台帳を表示しOK/直し指示を使用、配色候補なし |
| 4 完了UI | 満たす：安全なMarkdown表示、Markdown/PDFダウンロード、PDFが無ければpdfNote。議事録にiframe/画像なし。フォルダ操作の既存経路を維持（OSフォルダ表示の実操作は未確認） |
| 5 ダウンロードとパス検証 | 満たす：text/markdown; charset=utf-8・application/pdf・attachment。親/隣の依頼/絶対パス/junctionを拒否 |
| 6 偽AI | 満たす：台帳・decision・構成5項目/宿題表/引用/xx/未確認を含む本文・検査・レビュー・手直しを生成 |
| 7 domain/markdown/workflow | 満たす：配色無視・専用目安・安全な変換、簡易完了、詳細の停止/修正/承認/レビュー/手直し、旧レコードを検査 |
| 7 PDF | 満たす：実Chromeで%PDFを確認。依頼に途中HTMLなし、一時フォルダの削除・失敗・中断を検査 |
| 7 browser.e2e | 満たす：既存の提案詳細HTML、履歴/設定/配色操作、議事録簡易/詳細を通過。最終版を3回連続通過 |
| 7 lint・単体・e2e | 満たす：lint通過、単体34件、e2e3件。失敗・スキップ0件 |
| 8 README・STATUS | 満たす：議事録の説明・実CLI未確認と今回の検証記録を追記 |
| 変更禁止範囲 | 満たす：prompts/・docs/・設定・package.json・package-lock.json・Skillを変更しない。commit/pushなし |
| 受け入れ条件15（着手時） | 満たす：固定形式と配色ロックをブラウザで確認 |
| 受け入れ条件16（着手時） | 満たす（偽AI）：簡易のMarkdown/PDF、詳細の台帳承認→レビュー→手直し、ダウンロードを確認 |
| 受け入れ条件17（着手時） | 満たす（見本・指示検査）：構成・表・引用・xx・未確認を確認。実素材での正確性は未確認 |
| 受け入れ条件18（着手時） | 書式は満たす。1時間の実会議素材からA4 1〜2枚に収まるかは未確認 |

最終確認時、今回の編集とは別に DECISIONS.md と docs/REQUIREMENTS.md が更新されていました。追加された「議事録を詳細固定・途中停止なしにする」「完了後にMarkdownを編集・保存してPDFを再作成」「目的の並びを変更」は今回の前回指示に含まれないため未対応です。最新の受け入れ条件15・16への合格を示す表ではありません。これら2ファイルの変更は保全しています。

検証環境ではNEO_TEST_NO_SANDBOX=1、NEO_BROWSERに既存Chromeのパスを指定。サーバーは127.0.0.1:3210の偽AI（段階待機180ms）。アプリのPDF起動設定とiframeの隔離属性は維持しています。実CLI生成・本番ビルド・macOS/Linux実機・Edge単独環境・60秒タイムアウトの実待機試験は未確認です。CLI共通引数の議事録向け権限制限と、テスト用Chrome起動オプションは独立Reviewの対象です。

ライセンス: MIT（[LICENSE](LICENSE)）。第三者ライブラリの扱いは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。制作規則の読む順は [prompts/README.md](prompts/README.md)。
