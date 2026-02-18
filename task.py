#!/usr/bin/env python3
"""
task.py - Local AI-agent-friendly task management CLI.

Data is stored in tasks.json / archive.json.
Markdown views are generated in views/.
GitHub Projects sync via gh CLI.
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
TASKS_FILE = BASE_DIR / "tasks.json"
ARCHIVE_FILE = BASE_DIR / "archive.json"
CONFIG_FILE = BASE_DIR / "config.json"
VIEWS_DIR = BASE_DIR / "views"

STATUSES = ("TODO", "IN_PROGRESS", "PENDING", "DONE")


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------
def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _fmt_id(n: int) -> str:
    return f"t{n:03d}"


def _load_json(path: Path) -> dict:
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _load_tasks() -> dict:
    data = _load_json(TASKS_FILE)
    if "tasks" not in data:
        data = {"tasks": [], "next_id": 1}
    return data


def _save_tasks(data: dict) -> None:
    _save_json(TASKS_FILE, data)


def _load_archive() -> dict:
    data = _load_json(ARCHIVE_FILE)
    if "tasks" not in data:
        data = {"tasks": []}
    return data


def _save_archive(data: dict) -> None:
    _save_json(ARCHIVE_FILE, data)


def _load_config() -> dict:
    return _load_json(CONFIG_FILE)


def _find_task(data: dict, task_id: str):
    for t in data["tasks"]:
        if t["id"] == task_id:
            return t
    return None


def _new_task(data: dict, title: str, **kwargs) -> dict:
    tid = _fmt_id(data["next_id"])
    data["next_id"] += 1
    now = _now()
    task = {
        "id": tid,
        "title": title,
        "description": kwargs.get("description", ""),
        "status": "TODO",
        "tags": kwargs.get("tags", []),
        "due_date": kwargs.get("due_date"),
        "scheduled_date": kwargs.get("scheduled_date"),
        "completed_date": None,
        "parent_id": kwargs.get("parent_id"),
        "dependencies": kwargs.get("dependencies", []),
        "created_at": now,
        "updated_at": now,
        "github_issue_number": None,
        "github_project_item_id": None,
    }
    data["tasks"].append(task)
    return task


# ---------------------------------------------------------------------------
# View generation
# ---------------------------------------------------------------------------
def _generate_views(data: dict) -> None:
    VIEWS_DIR.mkdir(parents=True, exist_ok=True)
    active = [t for t in data["tasks"] if t["status"] != "DONE"]
    all_tasks = data["tasks"]
    _generate_list_view(all_tasks)
    _generate_kanban_view(all_tasks)
    _generate_process_view(all_tasks)


def _task_line(t: dict, indent: int = 0) -> str:
    check = "[x]" if t["status"] == "DONE" else "[ ]"
    prefix = "  " * indent + f"- {check} **[{t['id']}]** {t['title']}"
    parts = [prefix]
    if t.get("tags"):
        parts.append(" " + " ".join(f"`{tag}`" for tag in t["tags"]))
    if t.get("github_issue_number"):
        parts.append(f" (#{t['github_issue_number']})")
    line = "".join(parts)
    extras = []
    if t.get("dependencies"):
        extras.append("  " * (indent + 1) + "- 依存: " + ", ".join(t["dependencies"]))
    return line + ("\n" + "\n".join(extras) if extras else "")


def _generate_list_view(active: list) -> None:
    # Build parent-child map
    children_map: dict[str | None, list] = {}
    for t in active:
        pid = t.get("parent_id")
        children_map.setdefault(pid, []).append(t)

    lines = ["# タスク一覧\n"]
    for status in ("TODO", "IN_PROGRESS", "PENDING", "DONE"):
        top_tasks = [t for t in children_map.get(None, []) if t["status"] == status]
        if not top_tasks and not any(
            t["status"] == status for t in active if t.get("parent_id")
        ):
            continue
        lines.append(f"\n## {status}\n")
        if status == "DONE":
            # Group by completed_date
            from itertools import groupby
            sorted_tasks = sorted(top_tasks, key=lambda t: t.get("completed_date") or "", reverse=True)
            for date, group in groupby(sorted_tasks, key=lambda t: t.get("completed_date") or "不明"):
                lines.append(f"\n### 完了日（{date}）\n")
                for t in group:
                    lines.append(_task_line(t, 0))
                    for c in children_map.get(t["id"], []):
                        lines.append(_task_line(c, 1))
        elif status == "IN_PROGRESS":
            from itertools import groupby
            scheduled = [t for t in top_tasks if t.get("scheduled_date")]
            unscheduled = [t for t in top_tasks if not t.get("scheduled_date")]
            sorted_scheduled = sorted(scheduled, key=lambda t: t["scheduled_date"])
            for date, group in groupby(sorted_scheduled, key=lambda t: t["scheduled_date"]):
                lines.append(f"\n### 予定作業日（{date}）\n")
                for t in group:
                    lines.append(_task_line(t, 0))
                    for c in children_map.get(t["id"], []):
                        lines.append(_task_line(c, 1))
            for t in unscheduled:
                if t == unscheduled[0]:
                    lines.append(f"\n### 予定作業日未定\n")
                lines.append(_task_line(t, 0))
                for c in children_map.get(t["id"], []):
                    lines.append(_task_line(c, 1))
        elif status == "TODO":
            from itertools import groupby
            with_due = [t for t in top_tasks if t.get("due_date")]
            without_due = [t for t in top_tasks if not t.get("due_date")]
            sorted_due = sorted(with_due, key=lambda t: t["due_date"])
            for date, group in groupby(sorted_due, key=lambda t: t["due_date"]):
                lines.append(f"\n### 期限（{date}）\n")
                for t in group:
                    lines.append(_task_line(t, 0))
                    for c in children_map.get(t["id"], []):
                        lines.append(_task_line(c, 1))
            for t in without_due:
                if t == without_due[0]:
                    lines.append(f"\n### 期限未定\n")
                lines.append(_task_line(t, 0))
                for c in children_map.get(t["id"], []):
                    lines.append(_task_line(c, 1))
        else:
            for t in top_tasks:
                lines.append(_task_line(t, 0))
                # children
                for c in children_map.get(t["id"], []):
                    lines.append(_task_line(c, 1))

    lines.append(f"\n---\n*Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}*\n")
    (VIEWS_DIR / "list.md").write_text("\n".join(lines), encoding="utf-8")


def _generate_kanban_view(active: list) -> None:
    lines = ["# カンバンボード\n", "```mermaid", "flowchart LR"]
    status_labels = {"TODO": "📋 Todo", "IN_PROGRESS": "🔧 In Progress", "PENDING": "⏳ Pending", "DONE": "✅ Done"}
    status_keys = {"TODO": "todo", "IN_PROGRESS": "inprogress", "PENDING": "pending", "DONE": "done"}
    first_nodes = []
    for status in STATUSES:
        label = status_labels[status]
        key = status_keys[status]
        tasks = [t for t in active if t["status"] == status]
        lines.append(f'    subgraph {key}["{label}"]')
        lines.append(f"        direction TB")
        if tasks:
            first_nodes.append(tasks[0]["id"])
            for t in tasks:
                meta_parts = []
                if t.get("due_date"):
                    meta_parts.append(f"📅 {t['due_date']}")
                if t.get("tags"):
                    meta_parts.append(f"🏷 {', '.join(t['tags'])}")
                if t.get("github_issue_number"):
                    meta_parts.append(f"#{t['github_issue_number']}")
                title = _mermaid_escape(t["title"])
                meta = f"<br>{' '.join(meta_parts)}" if meta_parts else ""
                lines.append(f'        {t["id"]}["{t["id"]}: {title}{meta}"]')
        else:
            placeholder = f"{key}_empty"
            first_nodes.append(placeholder)
            lines.append(f"        {placeholder}[ ]")
        lines.append("    end")
    lines.append("")
    lines.append("    style todo fill:#f5f5f7,stroke:#d2d2d7,color:#1d1d1f,rx:12,ry:12")
    lines.append("    style inprogress fill:#f5f5f7,stroke:#d2d2d7,color:#1d1d1f,rx:12,ry:12")
    lines.append("    style pending fill:#f5f5f7,stroke:#d2d2d7,color:#1d1d1f,rx:12,ry:12")
    lines.append("    style done fill:#f5f5f7,stroke:#d2d2d7,color:#1d1d1f,rx:12,ry:12")
    lines.append("    classDef todo fill:#e8f5ff,stroke:#007aff,color:#1d1d1f,rx:10,ry:10")
    lines.append("    classDef inprogress fill:#fff4e6,stroke:#ff9f0a,color:#1d1d1f,rx:10,ry:10")
    lines.append("    classDef pending fill:#f3e8ff,stroke:#af52de,color:#1d1d1f,rx:10,ry:10")
    lines.append("    classDef done fill:#e5f8e8,stroke:#34c759,color:#1d1d1f,rx:10,ry:10")
    for status in STATUSES:
        key = status_keys[status]
        ids = [t["id"] for t in active if t["status"] == status]
        if ids:
            lines.append(f"    class {','.join(ids)} {key}")
    lines.append("```")
    lines.append(f"\n---\n*Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}*\n")
    (VIEWS_DIR / "kanban.md").write_text("\n".join(lines), encoding="utf-8")


def _mermaid_escape(text: str) -> str:
    """Escape special characters for Mermaid node labels."""
    for ch in ('"', "<", ">", "{", "}", "|"):
        text = text.replace(ch, f"#{ord(ch)};")
    return text


def _generate_process_view(active: list) -> None:
    task_map = {t["id"]: t for t in active}

    # Build parent-children map
    parent_children: dict[str, list[str]] = {}
    children_set: set[str] = set()
    for t in active:
        pid = t.get("parent_id")
        if pid and pid in task_map:
            parent_children.setdefault(pid, []).append(t["id"])
            children_set.add(t["id"])

    # Build adjacency for connected components (undirected)
    neighbors: dict[str, set[str]] = {t["id"]: set() for t in active}
    for t in active:
        for dep in t.get("dependencies", []):
            if dep in task_map:
                neighbors[t["id"]].add(dep)
                neighbors[dep].add(t["id"])
        pid = t.get("parent_id")
        if pid and pid in task_map:
            neighbors[t["id"]].add(pid)
            neighbors[pid].add(t["id"])

    # Find connected components via BFS
    visited: set[str] = set()
    components: list[list[str]] = []
    for tid in neighbors:
        if tid in visited:
            continue
        queue = [tid]
        visited.add(tid)
        comp: list[str] = []
        while queue:
            node = queue.pop(0)
            comp.append(node)
            for nb in sorted(neighbors[node]):
                if nb not in visited:
                    visited.add(nb)
                    queue.append(nb)
        components.append(comp)

    # Topological sort within each component (dependencies first)
    def topo_sort(ids: list[str]) -> list[str]:
        id_set = set(ids)
        in_deg = {i: 0 for i in ids}
        for i in ids:
            for dep in task_map[i].get("dependencies", []):
                if dep in id_set:
                    in_deg[i] += 1
        queue = sorted([i for i in ids if in_deg[i] == 0])
        result: list[str] = []
        while queue:
            node = queue.pop(0)
            result.append(node)
            for i in ids:
                if node in task_map[i].get("dependencies", []) and i in id_set:
                    in_deg[i] -= 1
                    if in_deg[i] == 0:
                        queue.append(i)
                        queue.sort()
        return result

    # Separate chains (2+ nodes) from independent nodes, sort chains
    chains = sorted(
        [c for c in components if len(c) > 1], key=lambda c: c[0]
    )
    independents = sorted(
        [c[0] for c in components if len(c) == 1],
        key=lambda tid: (task_map[tid]["status"] == "DONE", tid),
    )

    ordered: list[str] = []
    for chain in chains:
        ordered.extend(topo_sort(chain))
    ordered.extend(independents)

    lines = ["# プロセス図\n", "```mermaid", "flowchart LR"]

    # Render parent-child groups as subgraphs
    rendered: set[str] = set()
    for pid in sorted(parent_children.keys()):
        t = task_map[pid]
        title = _mermaid_escape(t["title"])
        lines.append(f'    subgraph {pid}["{pid}: {title}"]')
        rendered.add(pid)
        for cid in sorted(parent_children[pid]):
            ct = task_map[cid]
            ctitle = _mermaid_escape(ct["title"])
            lines.append(f'        {cid}["{cid}<br>{ctitle}"]')
            rendered.add(cid)
        lines.append("    end")

    # Remaining nodes
    for tid in ordered:
        if tid not in rendered:
            t = task_map[tid]
            title = _mermaid_escape(t["title"])
            lines.append(f'    {tid}["{tid}<br>{title}"]')

    # Edges (dependency -> task)
    lines.append("")
    for tid in ordered:
        t = task_map[tid]
        for dep in t.get("dependencies", []):
            if dep in task_map:
                lines.append(f"    {dep} --> {tid}")

    # Styles by status
    lines.append("")
    lines.append("    classDef todo fill:#e8f5ff,stroke:#007aff,color:#1d1d1f,rx:10,ry:10")
    lines.append("    classDef inprogress fill:#fff4e6,stroke:#ff9f0a,color:#1d1d1f,rx:10,ry:10")
    lines.append("    classDef pending fill:#f3e8ff,stroke:#af52de,color:#1d1d1f,rx:10,ry:10")
    lines.append("    classDef done fill:#e5f8e8,stroke:#34c759,color:#1d1d1f,rx:10,ry:10")

    status_class = {"TODO": "todo", "IN_PROGRESS": "inprogress", "PENDING": "pending", "DONE": "done"}
    for status, cls in status_class.items():
        ids = [t["id"] for t in active if t["status"] == status and t["id"] not in parent_children]
        if ids:
            lines.append(f"    class {','.join(ids)} {cls}")

    # Subgraph styles based on parent status
    sg_style = {
        "TODO": "fill:#f0f8ff,stroke:#007aff,stroke-width:2px",
        "IN_PROGRESS": "fill:#fff8f0,stroke:#ff9f0a,stroke-width:2px",
        "PENDING": "fill:#f8f0ff,stroke:#af52de,stroke-width:2px",
        "DONE": "fill:#f0fff2,stroke:#34c759,stroke-width:2px",
    }
    for pid in parent_children:
        status = task_map[pid]["status"]
        if status in sg_style:
            lines.append(f"    style {pid} {sg_style[status]}")

    lines.append("```")
    lines.append(f"\n---\n*Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}*\n")
    (VIEWS_DIR / "process.md").write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# CLI commands
# ---------------------------------------------------------------------------
def cmd_add(args) -> None:
    data = _load_tasks()
    tags = args.tag if args.tag else []
    deps = args.depends if args.depends else []
    task = _new_task(
        data,
        args.title,
        description=args.desc or "",
        tags=tags,
        due_date=args.due,
        scheduled_date=args.scheduled,
        parent_id=args.parent,
        dependencies=deps,
    )
    _save_tasks(data)
    _generate_views(data)
    print(f"Created {task['id']}: {task['title']}")


def cmd_list(args) -> None:
    data = _load_tasks()
    tasks = [t for t in data["tasks"] if t["status"] != "DONE"]
    if args.tag:
        tasks = [t for t in tasks if args.tag in t.get("tags", [])]
    if args.status:
        tasks = [t for t in tasks if t["status"] == args.status.upper()]
    if not tasks:
        print("No tasks found.")
        return
    for t in tasks:
        tags = " ".join(f"[{tg}]" for tg in t.get("tags", []))
        due = f" 📅{t['due_date']}" if t.get("due_date") else ""
        sch = f" 🗓️{t['scheduled_date']}" if t.get("scheduled_date") else ""
        gh = f" (#{t['github_issue_number']})" if t.get("github_issue_number") else ""
        status_icon = {"TODO": "○", "IN_PROGRESS": "▶", "PENDING": "⏳", "DONE": "✓"}.get(t["status"], "?")
        print(f"  {status_icon} {t['id']}  {t['title']}  {tags}{due}{sch}{gh}")


def cmd_show(args) -> None:
    data = _load_tasks()
    t = _find_task(data, args.task_id)
    if not t:
        # check archive
        arch = _load_archive()
        t = _find_task(arch, args.task_id)
        if not t:
            print(f"Task {args.task_id} not found.")
            return
        print("(archived)")
    for k, v in t.items():
        print(f"  {k}: {v}")


def cmd_edit(args) -> None:
    data = _load_tasks()
    t = _find_task(data, args.task_id)
    if not t:
        print(f"Task {args.task_id} not found.")
        return
    if args.title:
        t["title"] = args.title
    if args.desc is not None:
        t["description"] = args.desc
    if args.due is not None:
        t["due_date"] = args.due or None
    if args.scheduled is not None:
        t["scheduled_date"] = args.scheduled or None
    if args.tag:
        for spec in args.tag:
            if spec.startswith("add:"):
                tag = spec[4:]
                if tag not in t["tags"]:
                    t["tags"].append(tag)
            elif spec.startswith("rm:"):
                tag = spec[3:]
                if tag in t["tags"]:
                    t["tags"].remove(tag)
            else:
                if spec not in t["tags"]:
                    t["tags"].append(spec)
    t["updated_at"] = _now()
    _save_tasks(data)
    _generate_views(data)
    print(f"Updated {t['id']}: {t['title']}")


def cmd_delete(args) -> None:
    data = _load_tasks()
    t = _find_task(data, args.task_id)
    if not t:
        print(f"Task {args.task_id} not found.")
        return
    data["tasks"].remove(t)
    _save_tasks(data)
    _generate_views(data)
    print(f"Deleted {t['id']}: {t['title']}")


def cmd_done(args) -> None:
    data = _load_tasks()
    t = _find_task(data, args.task_id)
    if not t:
        print(f"Task {args.task_id} not found.")
        return
    t["status"] = "DONE"
    t["completed_date"] = _now()[:10]
    t["updated_at"] = _now()
    _save_tasks(data)
    _generate_views(data)
    print(f"Done {t['id']}: {t['title']}")


def cmd_start(args) -> None:
    data = _load_tasks()
    t = _find_task(data, args.task_id)
    if not t:
        print(f"Task {args.task_id} not found.")
        return
    t["status"] = "IN_PROGRESS"
    t["updated_at"] = _now()
    _save_tasks(data)
    _generate_views(data)
    print(f"Started {t['id']}: {t['title']}")


def cmd_pending(args) -> None:
    data = _load_tasks()
    t = _find_task(data, args.task_id)
    if not t:
        print(f"Task {args.task_id} not found.")
        return
    t["status"] = "PENDING"
    t["updated_at"] = _now()
    _save_tasks(data)
    _generate_views(data)
    print(f"Pending {t['id']}: {t['title']}")


def cmd_link(args) -> None:
    data = _load_tasks()
    has_dep = args.from_id and args.to_id
    has_parent = args.parent and args.child
    if not has_dep and not has_parent:
        print("Usage: link --from <id> --to <id>  OR  link --parent <id> --child <id>")
        return
    if has_dep:
        from_t = _find_task(data, args.from_id)
        to_t = _find_task(data, args.to_id)
        if not from_t:
            print(f"Task {args.from_id} not found.")
            return
        if not to_t:
            print(f"Task {args.to_id} not found.")
            return
        if args.from_id not in to_t["dependencies"]:
            to_t["dependencies"].append(args.from_id)
        to_t["updated_at"] = _now()
        print(f"Linked {args.from_id} -> {args.to_id} ({args.to_id} depends on {args.from_id})")
    if has_parent:
        parent_t = _find_task(data, args.parent)
        child_t = _find_task(data, args.child)
        if not parent_t:
            print(f"Parent task {args.parent} not found.")
            return
        if not child_t:
            print(f"Child task {args.child} not found.")
            return
        child_t["parent_id"] = args.parent
        child_t["updated_at"] = _now()
        print(f"Linked {args.child} as child of {args.parent}")
    _save_tasks(data)
    _generate_views(data)


def cmd_unlink(args) -> None:
    data = _load_tasks()
    has_dep = args.from_id and args.to_id
    has_parent = args.parent and args.child
    if not has_dep and not has_parent:
        print("Usage: unlink --from <id> --to <id>  OR  unlink --parent <id> --child <id>")
        return
    if has_dep:
        to_t = _find_task(data, args.to_id)
        if not to_t:
            print(f"Task {args.to_id} not found.")
            return
        if args.from_id in to_t["dependencies"]:
            to_t["dependencies"].remove(args.from_id)
        to_t["updated_at"] = _now()
        print(f"Unlinked dependency {args.from_id} -> {args.to_id}")
    if has_parent:
        child_t = _find_task(data, args.child)
        if not child_t:
            print(f"Child task {args.child} not found.")
            return
        child_t["parent_id"] = None
        child_t["updated_at"] = _now()
        print(f"Unlinked {args.child} from parent {args.parent}")
    _save_tasks(data)
    _generate_views(data)


def cmd_archive(args) -> None:
    data = _load_tasks()
    arch = _load_archive()
    done = [t for t in data["tasks"] if t["status"] == "DONE"]
    if not done:
        print("No completed tasks to archive.")
        return
    for t in done:
        data["tasks"].remove(t)
        arch["tasks"].append(t)
    _save_tasks(data)
    _save_archive(arch)
    _generate_views(data)
    print(f"Archived {len(done)} task(s).")


def cmd_view(args) -> None:
    data = _load_tasks()
    _generate_views(data)
    print(f"Views generated in {VIEWS_DIR}")


# ---------------------------------------------------------------------------
# GitHub sync helpers
# ---------------------------------------------------------------------------
def _gh(cmd_args: list[str], capture=True) -> subprocess.CompletedProcess:
    """Run a gh CLI command."""
    result = subprocess.run(
        ["gh"] + cmd_args,
        capture_output=capture,
        text=True,
        encoding="utf-8",
    )
    return result


def _gh_graphql(query: str, variables: dict | None = None) -> dict:
    """Run a gh api graphql query."""
    cmd = ["api", "graphql", "-f", f"query={query}"]
    if variables:
        for k, v in variables.items():
            cmd.extend(["-f", f"{k}={v}"])
    result = _gh(cmd)
    if result.returncode != 0:
        print(f"GraphQL error: {result.stderr}", file=sys.stderr)
        return {}
    return json.loads(result.stdout)


def _get_project_id(owner: str, project_number: int) -> str | None:
    """Get GitHub Project node ID."""
    query = """
    query($owner: String!, $number: Int!) {
      organization(login: $owner) {
        projectV2(number: $number) {
          id
        }
      }
    }
    """
    # Try org first, then user
    cmd = [
        "api", "graphql",
        "-f", f"query={query}",
        "-F", f"owner={owner}",
        "-F", f"number={project_number}",
    ]
    result = _gh(cmd)
    if result.returncode == 0:
        data = json.loads(result.stdout)
        proj = data.get("data", {}).get("organization", {}).get("projectV2")
        if proj:
            return proj["id"]
    # Try user
    query_user = query.replace("organization", "user")
    cmd[3] = f"query={query_user}"
    result = _gh(cmd)
    if result.returncode == 0:
        data = json.loads(result.stdout)
        proj = data.get("data", {}).get("user", {}).get("projectV2")
        if proj:
            return proj["id"]
    return None


def _get_project_status_field(project_id: str) -> tuple[str, dict] | None:
    """Get the Status field ID and option IDs for a project."""
    query = """
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
            }
          }
        }
      }
    }
    """
    cmd = ["api", "graphql", "-f", f"query={query}", "-f", f"projectId={project_id}"]
    result = _gh(cmd)
    if result.returncode != 0:
        return None
    data = json.loads(result.stdout)
    fields = data.get("data", {}).get("node", {}).get("fields", {}).get("nodes", [])
    for field in fields:
        if field.get("name") == "Status":
            options = {opt["name"]: opt["id"] for opt in field.get("options", [])}
            return field["id"], options
    return None


def _add_item_to_project(project_id: str, content_id: str) -> str | None:
    """Add an issue to a project. Returns the project item ID."""
    query = """
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
        item { id }
      }
    }
    """
    cmd = [
        "api", "graphql",
        "-f", f"query={query}",
        "-f", f"projectId={project_id}",
        "-f", f"contentId={content_id}",
    ]
    result = _gh(cmd)
    if result.returncode != 0:
        print(f"Failed to add to project: {result.stderr}", file=sys.stderr)
        return None
    data = json.loads(result.stdout)
    return data.get("data", {}).get("addProjectV2ItemById", {}).get("item", {}).get("id")


def _set_project_item_status(
    project_id: str, item_id: str, field_id: str, option_id: str
) -> bool:
    """Set the Status field of a project item."""
    query = """
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { singleSelectOptionId: $optionId }
      }) {
        projectV2Item { id }
      }
    }
    """
    cmd = [
        "api", "graphql",
        "-f", f"query={query}",
        "-f", f"projectId={project_id}",
        "-f", f"itemId={item_id}",
        "-f", f"fieldId={field_id}",
        "-f", f"optionId={option_id}",
    ]
    result = _gh(cmd)
    return result.returncode == 0


def _get_issue_node_id(repo: str, issue_number: int) -> str | None:
    """Get the node ID of an issue."""
    result = _gh([
        "issue", "view", str(issue_number),
        "--repo", repo,
        "--json", "id",
    ])
    if result.returncode != 0:
        return None
    return json.loads(result.stdout).get("id")


def _map_status_to_github(status: str) -> str:
    """Map local status to GitHub Project status name."""
    return {"TODO": "Todo", "IN_PROGRESS": "In Progress", "PENDING": "Pending", "DONE": "Done"}.get(status, "Todo")


def _map_status_from_github(gh_status: str) -> str:
    """Map GitHub Project status to local status."""
    mapping = {"Todo": "TODO", "In Progress": "IN_PROGRESS", "Pending": "PENDING", "Done": "DONE"}
    for k, v in mapping.items():
        if gh_status.lower() == k.lower():
            return v
    return "TODO"


def _build_issue_body(task: dict) -> str:
    """Build Issue body from task data."""
    parts = []
    if task.get("description"):
        parts.append(task["description"])
    parts.append("")
    parts.append("---")
    parts.append(f"**Local ID:** {task['id']}")
    if task.get("tags"):
        parts.append(f"**Tags:** {', '.join(task['tags'])}")
    if task.get("due_date"):
        parts.append(f"**Due:** {task['due_date']}")
    if task.get("scheduled_date"):
        parts.append(f"**Scheduled:** {task['scheduled_date']}")
    if task.get("parent_id"):
        parts.append(f"**Parent:** {task['parent_id']}")
    if task.get("dependencies"):
        parts.append(f"**Dependencies:** {', '.join(task['dependencies'])}")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# GitHub sync commands
# ---------------------------------------------------------------------------
def cmd_push(args) -> None:
    config = _load_config()
    gh_cfg = config.get("github", {})
    repo = gh_cfg.get("repo")
    project_number = gh_cfg.get("project_number")
    sync_tag = gh_cfg.get("sync_tag", "dev")

    if not repo or not project_number:
        print("GitHub config not set. Edit config.json.", file=sys.stderr)
        return

    owner = repo.split("/")[0]
    data = _load_tasks()

    # Filter tasks to push
    if args.task_id:
        targets = [t for t in data["tasks"] if t["id"] == args.task_id]
    else:
        targets = [t for t in data["tasks"] if sync_tag in t.get("tags", [])]

    if not targets:
        print("No tasks to push.")
        return

    # Get project ID
    project_id = _get_project_id(owner, project_number)
    if not project_id:
        print(f"Could not find Project #{project_number} for {owner}.", file=sys.stderr)
        return

    # Get status field info
    status_info = _get_project_status_field(project_id)
    if not status_info:
        print("Could not find Status field in project.", file=sys.stderr)
        return
    status_field_id, status_options = status_info

    for t in targets:
        if t.get("github_issue_number"):
            # Update existing issue
            issue_num = t["github_issue_number"]
            body = _build_issue_body(t)
            result = _gh([
                "issue", "edit", str(issue_num),
                "--repo", repo,
                "--title", t["title"],
                "--body", body,
            ])
            if result.returncode == 0:
                # Update status in project
                gh_status = _map_status_to_github(t["status"])
                option_id = status_options.get(gh_status)
                if option_id and t.get("github_project_item_id"):
                    _set_project_item_status(
                        project_id, t["github_project_item_id"],
                        status_field_id, option_id
                    )
                print(f"Updated #{issue_num} <- {t['id']}: {t['title']}")
            else:
                print(f"Failed to update #{issue_num}: {result.stderr}", file=sys.stderr)
        else:
            # Create new issue
            body = _build_issue_body(t)
            labels = ",".join(t.get("tags", []))
            cmd = [
                "issue", "create",
                "--repo", repo,
                "--title", t["title"],
                "--body", body,
            ]
            if labels:
                cmd.extend(["--label", labels])
            result = _gh(cmd)
            if result.returncode != 0:
                print(f"Failed to create issue for {t['id']}: {result.stderr}", file=sys.stderr)
                continue

            # Parse issue URL to get number
            issue_url = result.stdout.strip()
            issue_number = int(issue_url.rstrip("/").split("/")[-1])
            t["github_issue_number"] = issue_number

            # Add to project
            node_id = _get_issue_node_id(repo, issue_number)
            if node_id:
                item_id = _add_item_to_project(project_id, node_id)
                if item_id:
                    t["github_project_item_id"] = item_id
                    # Set status
                    gh_status = _map_status_to_github(t["status"])
                    option_id = status_options.get(gh_status)
                    if option_id:
                        _set_project_item_status(
                            project_id, item_id, status_field_id, option_id
                        )

            t["updated_at"] = _now()
            print(f"Pushed {t['id']} -> #{issue_number}: {t['title']}")

    _save_tasks(data)
    _generate_views(data)


def cmd_pull(args) -> None:
    config = _load_config()
    gh_cfg = config.get("github", {})
    repo = gh_cfg.get("repo")
    project_number = gh_cfg.get("project_number")
    sync_tag = gh_cfg.get("sync_tag", "dev")

    if not repo or not project_number:
        print("GitHub config not set. Edit config.json.", file=sys.stderr)
        return

    owner = repo.split("/")[0]
    data = _load_tasks()

    project_id = _get_project_id(owner, project_number)
    if not project_id:
        print(f"Could not find Project #{project_number}.", file=sys.stderr)
        return

    # Fetch project items via GraphQL
    query = """
    query($projectId: ID!, $cursor: String) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 100, after: $cursor) {
            nodes {
              id
              fieldValues(first: 10) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field { ... on ProjectV2SingleSelectField { name } }
                  }
                }
              }
              content {
                ... on Issue {
                  number
                  title
                  body
                  state
                  updatedAt
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
    """
    cmd = ["api", "graphql", "-f", f"query={query}", "-f", f"projectId={project_id}"]
    result = _gh(cmd)
    if result.returncode != 0:
        print(f"Failed to fetch project items: {result.stderr}", file=sys.stderr)
        return

    gh_data = json.loads(result.stdout)
    items = gh_data.get("data", {}).get("node", {}).get("items", {}).get("nodes", [])

    # Build lookup of local tasks by issue number
    local_by_issue = {}
    for t in data["tasks"]:
        if t.get("github_issue_number"):
            local_by_issue[t["github_issue_number"]] = t

    pulled = 0
    for item in items:
        content = item.get("content")
        if not content or "number" not in content:
            continue
        issue_num = content["number"]
        title = content["title"]
        gh_updated = content.get("updatedAt", "")

        # Determine project status
        gh_status_name = "Todo"
        for fv in item.get("fieldValues", {}).get("nodes", []):
            field = fv.get("field", {})
            if field.get("name") == "Status" and fv.get("name"):
                gh_status_name = fv["name"]
                break

        local_status = _map_status_from_github(gh_status_name)

        if issue_num in local_by_issue:
            # Update existing local task
            lt = local_by_issue[issue_num]
            changed = False
            if lt["title"] != title:
                lt["title"] = title
                changed = True
            if lt["status"] != local_status:
                lt["status"] = local_status
                if local_status == "DONE" and not lt.get("completed_date"):
                    lt["completed_date"] = _now()[:10]
                changed = True
            if not lt.get("github_project_item_id"):
                lt["github_project_item_id"] = item["id"]
                changed = True
            if changed:
                lt["updated_at"] = _now()
                pulled += 1
                print(f"Updated {lt['id']} <- #{issue_num}: {title} [{local_status}]")
        else:
            # New issue from GitHub -> create local task
            task = _new_task(data, title, tags=[sync_tag])
            task["github_issue_number"] = issue_num
            task["github_project_item_id"] = item["id"]
            task["status"] = local_status
            if local_status == "DONE":
                task["completed_date"] = _now()[:10]
            pulled += 1
            print(f"Pulled #{issue_num} -> {task['id']}: {title} [{local_status}]")

    _save_tasks(data)
    _generate_views(data)
    print(f"Pull complete. {pulled} task(s) updated/created.")


def cmd_sync(args) -> None:
    if args.status:
        _sync_status_check()
        return
    print("=== Push (local -> GitHub) ===")
    cmd_push(argparse.Namespace(task_id=None))
    print("\n=== Pull (GitHub -> local) ===")
    cmd_pull(argparse.Namespace())


def _sync_status_check() -> None:
    config = _load_config()
    gh_cfg = config.get("github", {})
    sync_tag = gh_cfg.get("sync_tag", "dev")
    data = _load_tasks()

    synced = [t for t in data["tasks"] if t.get("github_issue_number")]
    unsynced = [
        t for t in data["tasks"]
        if sync_tag in t.get("tags", []) and not t.get("github_issue_number")
    ]

    print(f"Synced tasks: {len(synced)}")
    for t in synced:
        print(f"  {t['id']} <-> #{t['github_issue_number']}  {t['title']}  [{t['status']}]")
    print(f"")
    print(f"Unsynced dev tasks: {len(unsynced)}")
    for t in unsynced:
        print(f"  {t['id']}  {t['title']}  [{t['status']}]")


# ---------------------------------------------------------------------------
# CLI argument parser
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="task",
        description="Local AI-agent-friendly task management CLI",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # add
    p_add = sub.add_parser("add", help="Add a new task")
    p_add.add_argument("title", help="Task title")
    p_add.add_argument("--desc", help="Description")
    p_add.add_argument("--tag", action="append", help="Tag (repeatable)")
    p_add.add_argument("--due", help="Due date (YYYY-MM-DD)")
    p_add.add_argument("--scheduled", help="Scheduled date (YYYY-MM-DD)")
    p_add.add_argument("--parent", help="Parent task ID")
    p_add.add_argument("--depends", action="append", help="Dependency task ID (repeatable)")

    # list
    p_list = sub.add_parser("list", help="List active tasks")
    p_list.add_argument("--tag", help="Filter by tag")
    p_list.add_argument("--status", help="Filter by status")

    # show
    p_show = sub.add_parser("show", help="Show task details")
    p_show.add_argument("task_id", help="Task ID")

    # edit
    p_edit = sub.add_parser("edit", help="Edit a task")
    p_edit.add_argument("task_id", help="Task ID")
    p_edit.add_argument("--title", help="New title")
    p_edit.add_argument("--desc", help="New description")
    p_edit.add_argument("--tag", action="append", help="Tag operation (add:xxx, rm:xxx, or xxx)")
    p_edit.add_argument("--due", help="Due date (YYYY-MM-DD, empty to clear)")
    p_edit.add_argument("--scheduled", help="Scheduled date (YYYY-MM-DD, empty to clear)")

    # delete
    p_del = sub.add_parser("delete", help="Delete a task")
    p_del.add_argument("task_id", help="Task ID")

    # done
    p_done = sub.add_parser("done", help="Mark task as done")
    p_done.add_argument("task_id", help="Task ID")

    # start
    p_start = sub.add_parser("start", help="Mark task as in progress")
    p_start.add_argument("task_id", help="Task ID")

    # pending
    p_pending = sub.add_parser("pending", help="Mark task as pending (waiting for others)")
    p_pending.add_argument("task_id", help="Task ID")

    # link
    p_link = sub.add_parser("link", help="Link tasks (parent/dependency)")
    p_link.add_argument("--from", dest="from_id", help="Dependency (upstream) task ID")
    p_link.add_argument("--to", dest="to_id", help="Dependent (downstream) task ID")
    p_link.add_argument("--parent", help="Parent task ID")
    p_link.add_argument("--child", help="Child task ID")

    # unlink
    p_unlink = sub.add_parser("unlink", help="Unlink tasks")
    p_unlink.add_argument("--from", dest="from_id", help="Dependency (upstream) task ID")
    p_unlink.add_argument("--to", dest="to_id", help="Dependent (downstream) task ID")
    p_unlink.add_argument("--parent", help="Parent task ID")
    p_unlink.add_argument("--child", help="Child task ID")

    # archive
    sub.add_parser("archive", help="Archive completed tasks")

    # view
    sub.add_parser("view", help="Generate markdown views")

    # push
    p_push = sub.add_parser("push", help="Push tasks to GitHub")
    p_push.add_argument("task_id", nargs="?", help="Specific task ID (optional)")

    # pull
    sub.add_parser("pull", help="Pull updates from GitHub")

    # sync
    p_sync = sub.add_parser("sync", help="Bidirectional sync with GitHub")
    p_sync.add_argument("--status", action="store_true", help="Show sync status only")

    return parser


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    dispatch = {
        "add": cmd_add,
        "list": cmd_list,
        "show": cmd_show,
        "edit": cmd_edit,
        "delete": cmd_delete,
        "done": cmd_done,
        "start": cmd_start,
        "pending": cmd_pending,
        "link": cmd_link,
        "unlink": cmd_unlink,
        "archive": cmd_archive,
        "view": cmd_view,
        "push": cmd_push,
        "pull": cmd_pull,
        "sync": cmd_sync,
    }
    dispatch[args.command](args)


if __name__ == "__main__":
    main()
