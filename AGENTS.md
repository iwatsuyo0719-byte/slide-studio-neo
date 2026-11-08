# AGENTS.md — SLIDE STUDIO NEO（スライド作成ツール）

このrepo内でClaude Code / Codexが従うルール。上位は `AI-COMMAND-CENTER/CLAUDE.md` と、Claude Codeなら `~/.claude/CLAUDE.md`、Codexなら `~/.codex/AGENTS.md`。矛盾する場合は上位とユーザーの明示指示が優先。

## 役割

`slide-studio` Skill（正本：`C:\Dev\AI_Workspace\01_Projects\Active\slide-studio`）の段取りを、選択式のUIから使えるツールにする。

- 2026-11-08 立ち上げ。**要件定義はまだ。** 決まったことは [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) と [DECISIONS.md](DECISIONS.md) に書く
- 現在地は [STATUS.md](STATUS.md)
- ユーザーからの初期要望は [docs/INITIAL_REQUEST.md](docs/INITIAL_REQUEST.md)

## 守ること

- GitHubで公開できる仕様にする：APIキー・`.env`・個人情報・有料の著作物・ライセンス不明の素材をrepoに入れない
- 視覚的成果物を作る前は `~/.claude/DESIGN_ROUTER.md` を読む。実制作の直前にGoogle Fonts利用可否をユーザーへ確認する
- 実装は `~/.claude/CODEX_DELEGATION.md` の手順でCodexへ委譲する（Claudeは要件整理・指示・レビュー）
- `slide-studio` 側のファイルは読むだけで書き換えない
- 作業後は `git status` を確認し、commit・pushまで行う（リモート作成後）

## CEOとの連携

- CEOスレッドからの指示は「背景／完了条件」付きで届く。終わったら1〜3行で報告する
