# SLIDE STUDIO NEO

素材を貼り付け、読み手・目的・出力形式を選ぶと、PC上のClaude Code / Codex CLIでスライドや議事録を作るローカルWebアプリです。

## 別のPCで使うまで

### 必要な物

| 必要な物 | 条件・用途 |
|---|---|
| Git | repoをcloneするために必要 |
| Node.js・npm | Node.js 20.9以上。LTS版を推奨 |
| Claude Code または Codex CLI | どちらか1つ以上。Claude Codeはclaude.aiのサブスク、CodexはChatGPTでログイン。APIキー認証は使いません |
| Python・python-pptx | pptx作成と構造の機械検査に必要。`python` または `python3` をPATHに追加 |
| Chrome または Edge | 議事録のPDF作成・スライドの機械検査に必要 |
| PowerPoint（Windows、任意） | pptxの全ページ画像化。利用者がPowerPointを開いている間は画像化しません |
| LibreOffice（任意） | PowerPointがない場合のプレビュー用。`soffice` をPATHに追加。全ページ画像には任意でPopplerの `pdftoppm` も必要 |

1. Git・Node.js・必要なCLIをインストールします。Claude Codeは公式の導入手順でインストールし、`claude auth login` でサブスクにログインします。Codex CLIは次の手順です。

   ```powershell
   npm install -g @openai/codex
   codex login
   ```

   Python導入後、利用するPythonに `pip install python-pptx`（または `python -m pip install python-pptx`）を実行します。CLIがPATHで見つからない場合はターミナルを開き直してください。

2. repoを取得し、依存をインストールします。

   ```powershell
   git clone https://github.com/iwatsuyo0719-byte/slide-studio-neo.git
   cd slide-studio-neo
   npm install
   ```

3. 環境を確認します。

   ```powershell
   npm run doctor
   ```

   各項目を「合格／不足／任意」で表示します。AIは片方が使えれば必須条件を満たします。必須項目が足りなければ終了コード1、そろっていれば0です。「不足」の対処を実行して再確認してください。doctorはCLIのヘルプとログイン状態だけを確認し、AIへの問い合わせや生成をしません。利用上限や実際の生成成功までは確認しません。

   `node_modules` がないとdoctorを動かすtsx自体もないため、必ず先に `npm install` を実行してください。

4. 本番用に起動します。以降のコマンドもrepoのルートで実行してください。

   ```powershell
   npm run build
   npm start
   ```

   まとめて実行する場合は `npm run app`（build成功後にstart）を使えます。起動中はターミナルを開いたままにし、終了は `Ctrl+C`。同じコードで次回起動するだけなら `npm start`、更新後は再ビルドしてください。

5. ブラウザで http://127.0.0.1:3000 を開きます。サーバーはこのPCのループバックアドレスで待ち受けます。
6. （Windows）デスクトップから起動したい時は、一度だけ `npm run shortcut` を実行します。デスクトップの「SLIDE STUDIO NEO」をダブルクリックすると、必要ならビルドしてから起動し、ブラウザが開きます（起動中ならブラウザを開くだけ）。出てくる黒い窓を閉じると終了します。中身は repo の `start-neo.cmd` です。

## 使い方と今の生成フロー

素材を貼り付けるか添付し、社内用／社外用・目的・出力・レベルを選んで生成します。設定画面のAI・モデル・深さは保存する既定値で、上部の札ではその依頼だけ変更できます。CLIを導入・ログインし直した後は画面の「CLIを再確認」を使えます。

### スライド

- 簡易：設計図で止まらず、制作・機械検査・AIの自己検査まで進みます。
- 詳細：設計図と配色を確認し、承認後に制作・機械検査・自己検査・レビュー・1周の手直しへ進みます。レビューは作ったAIと同じAIを新しく起動し、1回行います。
- AUTO：作るAIが簡易／詳細とその理由を判断します。

出力はHTMLまたは編集可能なpptxです。配色は100組から選べます。おまかせ配色は詳細で3候補を比較できます。

### 議事録

出力はMarkdownとPDF、レベルは詳細固定です。途中の台帳承認を挟まず進みます。

- 社内用：台帳・本文・自己確認をまとめて作り、機械検査・PDFまで進みます。
- 社外用：上に加えて、作ったAIと同じAIによる1回のレビューを行います。レビュー役が本文を修正します。利用上限などでレビューが止まった場合は再開できます。

完成後に台帳を読めます。「表示／編集」でMarkdownを編集し、「保存してPDFを作り直す」で保存とPDF再作成ができます。AIへの直し指示も使えます。基本はA4 2枚以下、内容が多い場合は3枚を目安とし、初回のPDFが3枚を超えると論点と経緯を1回だけ自動短縮します。PDFを作れない場合もMarkdownを残し、理由を表示します。

### 機械検査（P1）

スライドはツールが描画と、寸法・文字の大きさ・はみ出しなど測って決まる項目を検査します。HTMLはChrome / Edge、pptxの構造はPython・python-pptx、Windowsでのpptx画像化はPowerPointを使います。LibreOfficeでもプレビューを作れますが、PowerPointでの描画検査とは別です。画像化できなかった項目は未判定として残るため、ダウンロードしたpptxを確認してください。

議事録は見出し構成・宿題の表・引用・数字と素材の照合などを機械検査します。結果は成果物と一緒に確認でき、AIは判断が必要な内容を確認します。機械検査の合格だけで内容の正しさを保証するものではありません。

### 利用上限で止まったら

CLIの利用上限が解除されるのを待ち、履歴から依頼を開いて「再開」してください。保存済みの段階・ファイルを使って続けます。サーバー再起動後も履歴から再開できます。生成途中で停止しても依頼フォルダは残ります。

## 作業場所・設定・依頼フォルダ

作業データはrepoの外に保存します。

| 項目 | 保存先 |
|---|---|
| Windowsの既定の作業場所 | `%LOCALAPPDATA%\slide-studio-neo` |
| Windows以外の既定 | `$XDG_DATA_HOME/slide-studio-neo`。未設定なら `~/.local/share/slide-studio-neo` |
| 設定 | 作業場所の `settings.json`（設定画面に実際のパスを表示） |
| 依頼フォルダ | 作業場所の `requests/YYYY-MM-DD-題名-ID/` |
| 時間の実績 | 作業場所の `history.json`（偽AIは `history.fake.json`） |

環境変数 `NEO_WORKSPACE` で作業場所を変更できます。相対パスは起動時のrepoルート（`process.cwd()`）から解決します。例えばPowerShellでは、起動前に指定します。

```powershell
$env:NEO_WORKSPACE = 'D:\NEO-data'
npm run doctor
npm run app
```

各依頼には `request.md`、`material.md`、`attachments/`、`state.json`、`run.log` と成果物が残ります。スライドは `design.md`・`slides.pptx` または `index.html`、議事録は `ledger.md`・`minutes.md`・`minutes.pdf`（変換できた場合）です。検査・レビュー等の記録も該当する処理で保存します。別のPCへ過去データを移す場合は、サーバーを止めて作業場所をコピーし、移行先の `NEO_WORKSPACE` を合わせてください。

PDF用ブラウザが自動検出されない場合は `NEO_BROWSER` にChrome / Edgeの実行ファイルの絶対パスを指定できます。`NEO_BROWSER=none` はPDFなしの動作確認用です。

## CLIの実行とAPIキー

APIキーの入力欄はありません。NEOはCLIを起動する時に `ANTHROPIC_API_KEY`・`OPENAI_API_KEY`・`CODEX_API_KEY`・`ANTHROPIC_AUTH_TOKEN` を大文字小文字にかかわらず子プロセスの環境から外します。CLIのヘルプ・ログイン状態の確認も同じ環境で行います。サブスク認証で使い、APIキー課金を避ける仕組みです。doctorは値を表示せず、該当変数があることだけを注意表示します。

CLIは依頼フォルダを作業場所にし、シェルを挟まず起動します。利用者の共通CLI設定や認証情報を書き換えません。制作規則はこのrepoの `prompts/` が正本です。姉妹repoの導入は不要です。

## 開発者向け

### 型検査・単体テスト

```powershell
npm run lint
npm test
```

lintはTypeScriptの型検査です。テストは偽AIと一時作業場所を使い、実CLIで生成しません。doctorのNodeバージョン・AIの必須判定・終了コード・書き込み確認も単体テストに含みます。

### 開発起動・偽AI

```powershell
$env:NEO_FAKE_AI = '1'
$env:NEO_FAKE_DELAY_MS = '180'
npm run dev -- --port 3210
```

偽AIは実CLIの生成を呼ばず、動作確認用の成果物を返します。実AIの品質・所要時間の検証には使えません。doctorは `NEO_FAKE_AI=1` でも実際のCLIのログイン状態を確認します。素材の `[question]` は質問、`[error]` は本番でのエラーを再現します。テスト後は追加した環境変数を解除してください。

別ターミナルで偽AIサーバーに対して実行します。

```powershell
npm run test:http
npm run test:browser
npm run test:e2e
```

必要に応じて `NEO_TEST_URL`・`CHROME_PATH` を設定します。ブラウザテストは `test-results/` 内の独立したChromeプロファイルを使います。制限付きWindows環境でテスト用Chromeが起動しない時は、テスト時だけ `NEO_TEST_NO_SANDBOX=1` を指定できます。偽AIサーバーのPDFにも適用する場合は、起動前に `$env:NODE_OPTIONS = '--import=./tests/pdf-browser-hook.mjs'` を設定します。通常利用の設定にはしないでください。

ライセンス：MIT（[LICENSE](LICENSE)）。第三者ライブラリは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、制作規則の読む順は [prompts/README.md](prompts/README.md) を参照してください。
