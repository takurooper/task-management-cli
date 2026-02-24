# タスク管理 CLI (task.py)

ローカル・軽量で動作するAIエージェントフレンドリーなタスク管理ツール。

## セットアップ

```bash
# Python 3.10+ が必要（外部ライブラリ不要）
# GitHub同期を使う場合は gh CLI が必要
cd docs/todo
python task.py --help
```

## コマンド一覧

### タスク追加

```bash
python task.py add "タスク名"
python task.py add "タスク名" --tag dev --tag design --due 2026-03-01 --scheduled 2026-02-20
python task.py add "タスク" --project t001 --depends t002
```

### タスク一覧・詳細

```bash
python task.py list                # アクティブタスク一覧
python task.py list --tag dev      # タグでフィルタ
python task.py list --status TODO  # ステータスでフィルタ
python task.py show t001           # タスク詳細
```

### タスク編集

```bash
python task.py edit t001 --title "新しいタイトル"
python task.py edit t001 --tag add:urgent --tag rm:design
python task.py edit t001 --due 2026-04-01 --scheduled 2026-03-15
python task.py edit t001 --desc "詳細な説明文"
```

### ステータス変更

```bash
python task.py start t001    # TODO → IN_PROGRESS
python task.py pending t001  # → PENDING（関係者に依頼済・確認待ち）
python task.py done t001     # → DONE（完了日を自動設定）
```

ステータスは `TODO` → `IN_PROGRESS` → `PENDING` → `DONE` の4段階です。

### タスク間リンク

```bash
python task.py link --from t001 --to t003        # 依存関係（t001完了後にt003着手）
python task.py link --project t001 --task t002   # プロジェクトに追加
python task.py unlink --from t001 --to t003      # 依存解除
python task.py unlink --project t001 --task t002 # プロジェクトから除外
```

### アーカイブ

```bash
python task.py archive   # 完了タスクを archive.json に移動
```

### ビュー生成

```bash
python task.py view   # views/*.md + views/list.html + views/kanban.html + views/process.html を生成
python task.py serve  # views/ を http://127.0.0.1:8765 で配信（index.html で切替）
```

- `views/list.md` — チェックボックス付きリスト（親子構造付き）
  - TODO: 期限ごとにグルーピング（期限未定は「期限未定」）
  - IN_PROGRESS: 予定作業日ごとにグルーピング（未定は「予定作業日未定」）
  - DONE: 完了日ごとにグルーピング
- `views/kanban.md` — Mermaid kanban ダイアグラム
- `views/process.md` — 依存関係を矢印で示すMermaid プロセス図
- `views/list.html` — 静的Webリストビュー（検索 / ステータスフィルタ）
- `views/kanban.html` — 静的Webカンバンビュー（検索）
- `views/process.html` — 軽量SVG描画の静的Webプロセスビュー（`process.css`, `process.js` を同時生成）
- `views/index.html` — List / Kanban / Process の切替シェル

### ローカルWebサーバー

DevTools での調整用に、`views/` 配下をローカル配信できます。

```bash
python task.py serve
# オプション:
python task.py serve --host 0.0.0.0 --port 8765
python task.py serve --no-build   # 既存生成物をそのまま配信
```

- 既定URL: `http://127.0.0.1:8765/`
- 切替UI: `index.html`（List / Kanban / Process ボタン）
- API: 同一サーバーで `/api/*` を提供（Kanban の D&D 状態更新で利用）

主なAPI:

```text
GET    /api/tasks
POST   /api/tasks
PATCH  /api/tasks/:id
DELETE /api/tasks/:id
POST   /api/links/dependency
POST   /api/links/project
POST   /api/archive
POST   /api/view/regenerate
```

### 初期化

```bash
python task.py init   # tasks.json / archive.json / config.json を初期化し、ビューを再生成
```

### GitHub Projects 同期

```bash
python task.py push            # githubタグ付きタスクをGitHub Issue→Project追加
python task.py push t001       # 特定タスクのみpush
python task.py pull            # GitHub側の変更をローカルに反映
python task.py sync            # 双方向同期（push + pull）
python task.py sync --status   # 同期状態の確認
```

## データ構造

| ファイル | 説明 |
|---------|------|
| `tasks.json` | アクティブタスクの一元管理 |
| `archive.json` | 完了・アーカイブ済みタスク |
| `config.json` | GitHub連携設定 |
| `views/list.md` | リストビュー（自動生成） |
| `views/kanban.md` | カンバンビュー（自動生成） |
| `views/process.md` | プロセスビュー（自動生成） |
| `views/list.html` | 静的Webリストビュー（自動生成） |
| `views/kanban.html` | 静的Webカンバンビュー（自動生成） |
| `views/process.html` | 静的Webプロセスビュー（自動生成） |
| `views/index.html` | Webビュー切替シェル（自動生成） |

## AI Agent との連携

このツールはAIエージェントとの連携を前提に設計されています：

- **CLIコマンド**: AIが直接 `python task.py add/edit/start/pending/done` を実行可能
- **JSON直接編集**: `tasks.json` を直接読み書きしてタスクを操作可能
- **構造化データ**: 全データがJSON形式で機械可読
- **Markdownビュー**: 人間にもAIにも読みやすい形式で出力

## GitHub連携設定 (config.json)

```json
{
  "github": {
    "repo": "owner/repo",
    "project_number": 6,
    "sync_tag": "github"
  }
}
```

`sync_tag` に指定されたタグを持つタスクのみがGitHub Projectsと同期されます。

## Process Web View Styling (optional)

`task.py view` は `web-src/` をソースとして `views/common.css` / `views/list.css` / `views/kanban.css` / `views/process.css` と各 `*.js` を生成します。

ディレクトリ構成:

```text
web-src/
  templates/  # *.template.html
  scripts/    # *.js
  styles/     # *.css
  dist/styles/# ビルド済みCSS（任意、存在時に優先）
```

`views/process.css` は `web-src/dist/styles/process.css`（存在しない場合は `web-src/styles/process.css`）から出力されます。

Tailwind をビルド時だけ使って CSS を更新する場合:

```bash
npm install
npm run build:process-css
python task.py view
```
