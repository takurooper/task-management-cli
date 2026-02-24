# AGENTS.md - AIエージェント向け操作ガイド

## 重要ルール

### ビューの自動更新

タスクの追加・編集・削除・ステータス変更・依存関係変更など、`tasks.json` に変更を加えた場合は、**必ず最後に `python task.py view` を実行**してビューファイルを再生成すること。

```bash
# 例: タスク追加後
python task.py add "新しいタスク" --scheduled 2026-03-01
python task.py view
```

`tasks.json` を直接編集した場合も同様に `python task.py view` を実行すること。

## 基本操作

### 作業ディレクトリ

```
cd docs/todo
```

すべてのコマンドはこのディレクトリで実行する。

### タスク追加

```bash
python task.py add "タスク名"
python task.py add "タスク名" --tag github --due 2026-03-01 --scheduled 2026-02-20
python task.py add "タスク" --project p001 --depends t002
```

- `--tag`: タグ付け（複数指定可）。`github` タグを付けるとGitHub Projectsに同期対象になる
- `--due`: 期限日
- `--scheduled`: 実施予定日
- `--project`: プロジェクトID（`p001` 等。`tasks.json` の `projects` リストで定義）
- `--depends`: 依存タスクID（複数指定可）

### ステータス変更

```bash
python task.py start t001     # TODO → IN_PROGRESS
python task.py pending t001   # → PENDING（関係者に依頼済・確認待ち）
python task.py done t001      # → DONE（完了日を自動設定）
```

ステータスは `TODO` → `IN_PROGRESS` → `PENDING` → `DONE` の4段階。

### タスク編集

```bash
python task.py edit t001 --title "新しいタイトル"
python task.py edit t001 --desc "詳細な説明文"
python task.py edit t001 --tag add:urgent --tag rm:old
python task.py edit t001 --due 2026-04-01 --scheduled 2026-03-15
```

### 依存関係の操作

```bash
python task.py link --from t001 --to t003       # t001完了後にt003着手可能（依存関係）
python task.py link --project p001 --task t002  # t002をプロジェクトp001に追加
python task.py unlink --from t001 --to t003     # 依存解除
python task.py unlink --project p001 --task t002  # プロジェクトから除外
```

### タスク削除・アーカイブ

```bash
python task.py delete t001   # タスク削除
python task.py archive       # DONE タスクを archive.json に移動
python task.py archive --last-week  # 先週(月〜金)完了分をアーカイブ＋週報生成
```

`--last-week` を指定すると `reports/YYYY-MM-DD.md` に週報マークダウンが自動生成される。

## JSON直接編集

CLIが使えない場合やバッチ操作時は `tasks.json` を直接編集してもよい。

### データ構造

#### プロジェクト

`tasks.json` の `projects` リストに事前定義されている。タスクはプロジェクトに属することができる（1対多）。

```json
{
  "projects": [
    {"id": "p001", "title": "[コンセプト4] ゴールデンルートUI"},
    {"id": "p002", "title": "インタラクティブアプリ"}
  ],
  "next_project_id": 3
}
```

- `id` は `p` + 3桁ゼロ埋め（例: `p001`, `p005`）
- プロジェクトの追加は `tasks.json` を直接編集し `next_project_id` を更新

#### タスク

```json
{
  "id": "t001",
  "title": "タスク名",
  "description": "",
  "status": "TODO",
  "tags": [],
  "due_date": "2026-03-01",
  "scheduled_date": "2026-02-16",
  "completed_date": null,
  "project_id": null,
  "dependencies": ["t002", "t003"],
  "created_at": "2026-02-16T02:36:49Z",
  "updated_at": "2026-02-16T02:36:49Z",
  "github_issue_number": null,
  "github_project_item_id": null
}
```

### 直接編集時の注意

- `next_id` を新しいタスク数に合わせてインクリメントすること
- `id` は `t` + 3桁ゼロ埋め（例: `t001`, `t012`）
- `status` は `TODO`, `IN_PROGRESS`, `PENDING`, `DONE` のいずれか
- `created_at`, `updated_at` はISO 8601 UTC形式
- **編集後は必ず `python task.py view` を実行**

## ビューファイル

`python task.py view` で以下の3ファイルが `views/` に生成される:

| ファイル | 内容 |
|---------|------|
| `views/list.md` | チェックボックス付きリスト（プロジェクト構造付き） |
| `views/kanban.md` | Mermaid kanban ダイアグラム |
| `views/process.md` | 依存関係を矢印で示す Mermaid プロセス図 |

これらは自動生成ファイルなので直接編集しないこと。

## GitHub同期

`config.json` の `sync_tag` に指定されたタグ（現在: `github`）を持つタスクのみが同期対象。

```bash
python task.py push            # githubタグ付きタスクをGitHub Issue→Project追加
python task.py push t001       # 特定タスクのみpush
python task.py pull            # GitHub側の変更をローカルに反映
python task.py sync            # 双方向同期（push + pull）
python task.py sync --status   # 同期状態の確認
```

同期には `gh` CLI がインストール・認証済みである必要がある。
