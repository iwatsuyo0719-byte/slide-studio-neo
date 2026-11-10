# AGENTS.md — SLIDE STUDIO NEO（スライド作成ツール）

このrepo内でClaude Code / Codexが従うルール。上位は `AI-COMMAND-CENTER/CLAUDE.md` と、Claude Codeなら `~/.claude/CLAUDE.md`、Codexなら `~/.codex/AGENTS.md`。矛盾する場合は上位とユーザーの明示指示が優先。

## 役割

`slide-studio` Skill（正本：`C:\Dev\AI_Workspace\01_Projects\Active\slide-studio`）の段取りを、選択式のUIから使えるツールにする。

- 2026-11-08 立ち上げ、要件定義 v1.0 承認済み。v1（スライド・議事録）実装済みで、いまは生成コストの改良中。仕様は [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)、決定は [DECISIONS.md](DECISIONS.md) に書く
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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
