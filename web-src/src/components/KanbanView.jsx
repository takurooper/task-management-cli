import { h } from "preact";
import { useState, useMemo, useCallback, useRef } from "preact/hooks";
import * as api from "../api/client";
import { TaskPopup } from "./TaskPopup";

const STATUSES = ["TODO", "IN_PROGRESS", "PENDING", "DONE"];

function taskMeta(t) {
  const parts = [];
  if (t.due_date) parts.push(`due ${t.due_date}`);
  if (t.scheduled_date) parts.push(`scheduled ${t.scheduled_date}`);
  if (Array.isArray(t.tags) && t.tags.length) parts.push(`#${t.tags.join(" #")}`);
  return parts.join(" / ") || "-";
}

export function KanbanView({ data, projects, onDataChanged }) {
  const [columns, setColumns] = useState(() => {
    const cols = {};
    for (const s of STATUSES) {
      cols[s] = Array.isArray(data.columns?.[s]) ? data.columns[s].map((t) => ({ ...t })) : [];
    }
    return cols;
  });
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState({ text: "", kind: "" });
  const [popupTask, setPopupTask] = useState(null);
  const draggingRef = useRef(null);
  const timerRef = useRef(null);

  const allTasks = useMemo(() => STATUSES.flatMap((s) => columns[s]), [columns]);

  const findTask = useCallback((taskId) => {
    for (const s of STATUSES) {
      const idx = columns[s].findIndex((t) => t.id === taskId);
      if (idx >= 0) return { status: s, index: idx, task: columns[s][idx] };
    }
    return null;
  }, [columns]);

  const replaceTask = useCallback((updated) => {
    setColumns((prev) => {
      const next = {};
      for (const s of STATUSES) {
        next[s] = prev[s].map((t) => (t.id === updated.id ? { ...updated } : t));
      }
      return next;
    });
  }, []);

  const removeTask = useCallback((id) => {
    setColumns((prev) => {
      const next = {};
      for (const s of STATUSES) {
        next[s] = prev[s].filter((t) => t.id !== id);
      }
      return next;
    });
  }, []);

  const handleDrop = useCallback(async (taskId, targetStatus) => {
    const located = findTask(taskId);
    if (!located || located.status === targetStatus) return;
    const { status: fromStatus, task } = located;
    const expectedUpdatedAt = task.updated_at;

    // Optimistic move
    setColumns((prev) => {
      const next = {};
      for (const s of STATUSES) next[s] = [...prev[s]];
      const idx = next[fromStatus].findIndex((t) => t.id === taskId);
      if (idx >= 0) {
        const [moved] = next[fromStatus].splice(idx, 1);
        moved.status = targetStatus;
        next[targetStatus].push(moved);
      }
      return next;
    });
    setNotice({ text: `Updating ${taskId} → ${targetStatus} ...`, kind: "info" });

    try {
      const res = await api.updateTask(taskId, expectedUpdatedAt, { status: targetStatus });
      replaceTask(res.task);
      setNotice({ text: "", kind: "" });
      onDataChanged?.();
    } catch (err) {
      // Rollback
      setColumns((prev) => {
        const next = {};
        for (const s of STATUSES) next[s] = [...prev[s]];
        const idx = next[targetStatus].findIndex((t) => t.id === taskId);
        if (idx >= 0) {
          const [moved] = next[targetStatus].splice(idx, 1);
          moved.status = fromStatus;
          next[fromStatus].push(moved);
        }
        return next;
      });
      if (err?.status === 409 && err?.payload?.latest) {
        replaceTask(err.payload.latest);
        setNotice({ text: `Conflict on ${taskId}. latest state was applied.`, kind: "warn" });
      } else {
        setNotice({ text: `Failed to update ${taskId}: ${err?.message || "unknown"}`, kind: "error" });
      }
    }
  }, [findTask, replaceTask, onDataChanged]);

  const matches = useCallback((task) => {
    if (!query) return true;
    const tags = Array.isArray(task.tags) ? task.tags.join(" ") : "";
    return `${task.id} ${task.title || ""} ${tags}`.toLowerCase().includes(query);
  }, [query]);

  const handleSearch = useCallback((e) => {
    clearTimeout(timerRef.current);
    const val = e.target.value;
    timerRef.current = setTimeout(() => {
      setQuery(String(val || "").trim().toLowerCase());
    }, 80);
  }, []);

  return (
    <div>
      <section class="controls">
        <label class="field search">
          <span>Search</span>
          <input class="kv-search" type="search" placeholder="task id / title / tag" onInput={handleSearch} />
        </label>
      </section>

      <section class="notice" aria-live="polite" data-kind={notice.kind}>{notice.text}</section>

      <section class="board" aria-label="kanban board">
        {STATUSES.map((status) => {
          const items = (columns[status] || []).filter(matches);
          return (
            <Lane key={status} status={status} items={items}
              draggingRef={draggingRef} onDrop={handleDrop}
              onCardClick={(t) => setPopupTask(t)} />
          );
        })}
      </section>

      {popupTask && (
        <TaskPopup task={popupTask} projects={projects}
          onUpdate={(updated) => { replaceTask(updated); onDataChanged?.(); }}
          onDelete={(id) => { removeTask(id); onDataChanged?.(); }}
          onClose={() => setPopupTask(null)} />
      )}
    </div>
  );
}

function Lane({ status, items, draggingRef, onDrop, onCardClick }) {
  const [droppable, setDroppable] = useState(false);

  const handleDragOver = useCallback((e) => { e.preventDefault(); setDroppable(true); }, []);
  const handleDragLeave = useCallback(() => setDroppable(false), []);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDroppable(false);
    const taskId = e.dataTransfer?.getData("text/task-id") || draggingRef.current;
    if (taskId) onDrop(taskId, status);
  }, [status, onDrop, draggingRef]);

  return (
    <section class={`lane ${status.toLowerCase().replace("_", "")}${droppable ? " droppable" : ""}`}
      data-status={status} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <h2>{status} ({items.length})</h2>
      <div class="stack">
        {items.map((t) => (
          <KanbanCard key={t.id} task={t} draggingRef={draggingRef} onClick={() => onCardClick(t)} />
        ))}
      </div>
    </section>
  );
}

function KanbanCard({ task, draggingRef, onClick }) {
  const didDragRef = useRef(false);

  const handleDragStart = useCallback((e) => {
    draggingRef.current = task.id;
    didDragRef.current = true;
    e.currentTarget.classList.add("dragging");
    if (e.dataTransfer) {
      e.dataTransfer.setData("text/task-id", task.id);
      e.dataTransfer.effectAllowed = "move";
    }
  }, [task.id, draggingRef]);

  const handleDragEnd = useCallback((e) => {
    draggingRef.current = null;
    e.currentTarget.classList.remove("dragging");
  }, [draggingRef]);

  const handleClick = useCallback(() => {
    if (didDragRef.current) { didDragRef.current = false; return; }
    onClick();
  }, [onClick]);

  return (
    <article class="card" draggable data-task-id={task.id}
      onDragStart={handleDragStart} onDragEnd={handleDragEnd} onClick={handleClick}>
      <div class="id">{task.id}</div>
      <h3>{task.title || ""}</h3>
      <p>{taskMeta(task)}</p>
    </article>
  );
}
