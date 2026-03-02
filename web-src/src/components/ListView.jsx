import { h } from "preact";
import { useState, useMemo, useCallback, useRef, useEffect } from "preact/hooks";
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

function token(task) {
  const tags = Array.isArray(task.tags) ? task.tags.join(" ") : "";
  return `${task.id} ${task.title || ""} ${tags}`.toLowerCase();
}

export function ListView({ data, projects, onDataChanged }) {
  const [tasks, setTasks] = useState(() => (data.tasks || []).map((t) => ({ ...t })));
  const [query, setQuery] = useState("");
  const [activeStatuses, setActiveStatuses] = useState(() => new Set(STATUSES));
  const [notice, setNotice] = useState({ text: "", kind: "" });
  const [popupTask, setPopupTask] = useState(null);
  const draggingRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    setTasks((data.tasks || []).map((t) => ({ ...t })));
  }, [data.tasks]);

  const replaceTask = useCallback((updated) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? { ...updated } : t)));
  }, []);

  const removeTask = useCallback((id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const visible = useCallback((task) => {
    if (!activeStatuses.has(task.status)) return false;
    if (!query) return true;
    return token(task).includes(query);
  }, [activeStatuses, query]);

  const grouped = useMemo(() => {
    const g = { TODO: [], IN_PROGRESS: [], PENDING: [], DONE: [] };
    for (const t of tasks) {
      if (visible(t)) g[t.status]?.push(t);
    }
    return g;
  }, [tasks, visible]);

  const handleDrop = useCallback(async (taskId, targetStatus) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === targetStatus) return;
    const expectedUpdatedAt = task.updated_at;
    const fromStatus = task.status;

    // Optimistic update
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: targetStatus } : t)));
    setNotice({ text: `Updating ${taskId} → ${targetStatus} ...`, kind: "info" });

    try {
      const res = await api.updateTask(taskId, expectedUpdatedAt, { status: targetStatus });
      replaceTask(res.task || { ...task, status: targetStatus });
      setNotice({ text: "", kind: "" });
      onDataChanged?.();
    } catch (err) {
      // Rollback
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: fromStatus } : t)));
      if (err?.status === 409 && err?.payload?.latest) {
        replaceTask(err.payload.latest);
        setNotice({ text: `Conflict on ${taskId}. latest state was applied.`, kind: "warn" });
      } else {
        setNotice({ text: `Failed to update ${taskId}: ${err?.message || "unknown error"}`, kind: "error" });
      }
    }
  }, [tasks, replaceTask, onDataChanged]);

  const handleSearch = useCallback((e) => {
    clearTimeout(timerRef.current);
    const val = e.target.value;
    timerRef.current = setTimeout(() => {
      setQuery(String(val || "").trim().toLowerCase());
    }, 80);
  }, []);

  const toggleStatus = useCallback((status, checked) => {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (checked) next.add(status);
      else next.delete(status);
      return next;
    });
  }, []);

  return (
    <div>
      <section class="controls">
        <label class="field search">
          <span>Search</span>
          <input class="lv-search" type="search" placeholder="task id / title / tag" onInput={handleSearch} />
        </label>
        <fieldset class="status-filters">
          <legend>Status</legend>
          {STATUSES.map((s) => (
            <label key={s}>
              <input type="checkbox" value={s} checked={activeStatuses.has(s)}
                onChange={(e) => toggleStatus(s, e.target.checked)} />
              {s}
            </label>
          ))}
        </fieldset>
      </section>

      <section class="notice" aria-live="polite" data-kind={notice.kind}>{notice.text}</section>

      <section class="list-root">
        {STATUSES.map((status) => (
          <StatusSection key={status} status={status} items={grouped[status]}
            draggingRef={draggingRef} onDrop={handleDrop}
            onCardClick={(t) => setPopupTask(t)} />
        ))}
      </section>

      {popupTask && (
        <TaskPopup key={popupTask.id} task={popupTask} projects={projects}
          onUpdate={(updated) => { replaceTask(updated); onDataChanged?.(); }}
          onDelete={(id) => { removeTask(id); onDataChanged?.(); }}
          onClose={() => setPopupTask(null)} />
      )}
    </div>
  );
}

function StatusSection({ status, items, draggingRef, onDrop, onCardClick }) {
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
    <section class={`status-section${droppable ? " droppable" : ""}`} data-status={status}
      onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <h2>{status} ({items.length})</h2>
      <ul class="task-list">
        {items.map((t) => (
          <TaskRow key={t.id} task={t} status={status} draggingRef={draggingRef} onClick={() => onCardClick(t)} />
        ))}
      </ul>
    </section>
  );
}

function TaskRow({ task, status, draggingRef, onClick }) {
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
    <li class={`task-row ${status.toLowerCase().replace("_", "")}`} draggable
      data-task-id={task.id} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onClick={handleClick}>
      <div class="main-line">
        <span class="id">{task.id}</span>
        <span class="title">{task.title || ""}</span>
      </div>
      <div class="sub-line">{taskMeta(task)}</div>
    </li>
  );
}
