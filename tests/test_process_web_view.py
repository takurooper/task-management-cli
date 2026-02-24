import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TASK_PY = ROOT / "task.py"

spec = importlib.util.spec_from_file_location("task_module", TASK_PY)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)


class ProcessWebViewTests(unittest.TestCase):
    def test_build_graph_model_filters_invalid_links(self):
        projects = [{"id": "p001", "title": "Project A"}]
        tasks = [
            {
                "id": "t001",
                "title": "A",
                "status": "TODO",
                "updated_at": "2026-01-01T00:00:00Z",
                "project_id": "p001",
                "dependencies": [],
                "tags": [],
            },
            {
                "id": "t002",
                "title": "B",
                "status": "IN_PROGRESS",
                "updated_at": "2026-01-01T00:00:01Z",
                "project_id": "p001",
                "dependencies": ["t001", "missing", "t002"],
                "tags": ["ui"],
            },
        ]
        model = mod._build_process_graph_model(tasks, projects)

        self.assertEqual(len(model["nodes"]), 2)
        self.assertEqual(len(model["edges"]), 1)
        self.assertEqual(model["edges"][0], {"from": "t001", "to": "t002", "type": "dependency"})
        self.assertEqual(model["groups"][0]["id"], "p001")
        self.assertEqual(model["groups"][0]["members"], ["t001", "t002"])
        self.assertEqual(model["nodes"][1]["updated_at"], "2026-01-01T00:00:01Z")

    def test_layout_is_deterministic_and_non_overlapping(self):
        tasks = [
            {
                "id": "t001",
                "title": "A",
                "status": "TODO",
                "project_id": None,
                "dependencies": [],
                "tags": [],
            },
            {
                "id": "t002",
                "title": "B",
                "status": "TODO",
                "project_id": None,
                "dependencies": ["t001"],
                "tags": [],
            },
            {
                "id": "t003",
                "title": "C",
                "status": "PENDING",
                "project_id": None,
                "dependencies": ["t002"],
                "tags": [],
            },
        ]

        model = mod._build_process_graph_model(tasks)
        l1 = mod._layout_process_graph(model)
        l2 = mod._layout_process_graph(model)

        p1 = {(n["id"], n["x"], n["y"]) for n in l1["nodes"]}
        p2 = {(n["id"], n["x"], n["y"]) for n in l2["nodes"]}
        self.assertEqual(p1, p2)

        rects = [(n["x"], n["y"], n["x"] + n["w"], n["y"] + n["h"]) for n in l1["nodes"]]
        for i, (ax1, ay1, ax2, ay2) in enumerate(rects):
            for bx1, by1, bx2, by2 in rects[i + 1 :]:
                overlap = not (ax2 <= bx1 or bx2 <= ax1 or ay2 <= by1 or by2 <= ay1)
                self.assertFalse(overlap)

    def test_project_group_boxes_do_not_overlap_and_are_left_aligned(self):
        projects = [
            {"id": "p001", "title": "P1"},
            {"id": "p002", "title": "P2"},
        ]
        tasks = [
            {"id": "t003", "title": "A", "status": "TODO", "project_id": "p001", "dependencies": [], "tags": []},
            {"id": "t004", "title": "B", "status": "TODO", "project_id": "p001", "dependencies": ["t003"], "tags": []},
            {"id": "t005", "title": "C", "status": "TODO", "project_id": "p002", "dependencies": [], "tags": []},
        ]
        model = mod._build_process_graph_model(tasks, projects)
        layout = mod._layout_process_graph(model)
        groups = layout["groups"]

        self.assertGreaterEqual(len(groups), 2)
        self.assertEqual(len({g["x"] for g in groups}), 1)

        rects = [(g["x"], g["y"], g["x"] + g["w"], g["y"] + g["h"]) for g in groups]
        for i, (ax1, ay1, ax2, ay2) in enumerate(rects):
            for bx1, by1, bx2, by2 in rects[i + 1 :]:
                overlap = not (ax2 <= bx1 or bx2 <= ax1 or ay2 <= by1 or by2 <= ay1)
                self.assertFalse(overlap)

    def test_project_with_more_dependency_depth_gets_wider(self):
        projects = [
            {"id": "p001", "title": "Wide"},
            {"id": "p002", "title": "Narrow"},
        ]
        tasks = [
            {"id": "t003", "title": "W1", "status": "TODO", "project_id": "p001", "dependencies": [], "tags": []},
            {"id": "t004", "title": "W2", "status": "TODO", "project_id": "p001", "dependencies": ["t003"], "tags": []},
            {"id": "t005", "title": "W3", "status": "TODO", "project_id": "p001", "dependencies": ["t004"], "tags": []},
            {"id": "t006", "title": "N1", "status": "TODO", "project_id": "p002", "dependencies": [], "tags": []},
        ]
        model = mod._build_process_graph_model(tasks, projects)
        layout = mod._layout_process_graph(model)
        groups = {g["id"]: g for g in layout["groups"]}

        self.assertIn("p001", groups)
        self.assertIn("p002", groups)
        self.assertGreater(groups["p001"]["w"], groups["p002"]["w"])

    def test_list_and_kanban_payload_shape(self):
        tasks = [
            {
                "id": "t001",
                "title": "A",
                "status": "TODO",
                "project_id": None,
                "dependencies": [],
                "tags": ["core"],
                "due_date": None,
                "scheduled_date": None,
                "completed_date": None,
                "updated_at": "2026-01-01T00:00:00Z",
                "github_issue_number": None,
            },
            {
                "id": "t002",
                "title": "B",
                "status": "IN_PROGRESS",
                "project_id": None,
                "dependencies": ["t001"],
                "tags": [],
                "due_date": "2026-03-01",
                "scheduled_date": "2026-02-21",
                "completed_date": None,
                "updated_at": "2026-01-01T00:00:01Z",
                "github_issue_number": 123,
            },
        ]

        list_payload = mod._build_list_web_payload(tasks)
        kanban_payload = mod._build_kanban_web_payload(tasks)

        self.assertEqual(list_payload["meta"]["task_count"], 2)
        self.assertEqual(len(list_payload["tasks"]), 2)
        self.assertEqual(list_payload["tasks"][0]["updated_at"], "2026-01-01T00:00:00Z")
        self.assertEqual(len(kanban_payload["columns"]["TODO"]), 1)
        self.assertEqual(len(kanban_payload["columns"]["IN_PROGRESS"]), 1)

    def test_process_payload_includes_layout_mode(self):
        tasks = [
            {"id": "t001", "title": "A", "status": "TODO", "project_id": None, "dependencies": [], "tags": []}
        ]
        payload = mod._build_process_web_payload(tasks)
        self.assertEqual(payload["meta"]["layout_mode"], "project_rows")

    def test_process_payload_groups_by_project(self):
        projects = [{"id": "p001", "title": "Project"}]
        tasks = [
            {"id": "t001", "title": "Task A", "status": "TODO", "project_id": "p001", "dependencies": [], "tags": []},
            {"id": "t002", "title": "Task B", "status": "TODO", "project_id": None, "dependencies": [], "tags": []},
        ]
        payload = mod._build_process_web_payload(tasks, projects)
        ids = [n["id"] for n in payload["nodes"]]
        self.assertIn("t001", ids)
        self.assertIn("t002", ids)
        self.assertEqual(len(payload["groups"]), 1)
        self.assertEqual(payload["groups"][0]["id"], "p001")
        self.assertEqual(payload["groups"][0]["title"], "Project")

    def test_check_expected_updated_at(self):
        task = {"id": "t001", "updated_at": "2026-01-01T00:00:00Z"}
        ok, err = mod._check_expected_updated_at(task, "2026-01-01T00:00:00Z")
        self.assertTrue(ok)
        self.assertIsNone(err)

        ok, err = mod._check_expected_updated_at(task, "2026-01-01T00:00:01Z")
        self.assertFalse(ok)
        self.assertEqual(err["code"], "conflict")


if __name__ == "__main__":
    unittest.main()
