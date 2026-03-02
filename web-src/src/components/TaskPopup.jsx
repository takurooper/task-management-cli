import { h } from "preact";
import { useState, useRef, useEffect, useCallback } from "preact/hooks";
import * as api from "../api/client";

const STATUSES = ["TODO", "IN_PROGRESS", "PENDING", "DONE"];

export function TaskPopup({ task, projects, onUpdate, onDelete, onClose }) {
  if (!task) return null;

  const [notice, setNotice] = useState({ text: "", kind: "" });
  const titleRef = useRef(null);
  const formRef = useRef(null);

  useEffect(() => {
    const form = formRef.current;
    const set = (name, value) => {
      const el = form?.elements?.[name];
      if (el) el.value = value ?? "";
    };
    set("title", task.title || "");
    set("status", task.status || "TODO");
    set("project_id", task.project_id || "");
    set("scheduled_date", task.scheduled_date || "");
    set("due_date", task.due_date || "");
    set("tags", (task.tags || []).join(", "));
    set("description", task.description || "");
    if (titleRef.current) titleRef.current.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [task.id, task.updated_at]);

  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const handleSave = useCallback(async (e) => {
    e.preventDefault();
    const form = e.target;
    const get = (n) => form.elements[n]?.value;

    const changes = {};
    const title = get("title");
    if (title !== (task.title || "")) changes.title = title;
    const status = get("status");
    if (status && status !== task.status) changes.status = status;
    const projectEl = form.elements["project_id"];
    const projectId = get("project_id") || null;
    const oldProjectId = task.project_id || null;
    const hasOldOption = !oldProjectId || Array.from(projectEl?.options || []).some((o) => o.value === oldProjectId);
    // Guard against accidental unlink when project options are missing and select falls back to "(none)".
    if (projectId !== oldProjectId && (projectId !== null || hasOldOption)) changes.project_id = projectId;
    const scheduled = get("scheduled_date");
    if (scheduled !== (task.scheduled_date || "")) changes.scheduled_date = scheduled || null;
    const due = get("due_date");
    if (due !== (task.due_date || "")) changes.due_date = due || null;
    const newTags = get("tags").split(",").map((t) => t.trim()).filter(Boolean);
    if (JSON.stringify(newTags) !== JSON.stringify(task.tags || [])) changes.tags = newTags;
    const desc = get("description");
    if (desc !== (task.description || "")) changes.description = desc;

    if (!Object.keys(changes).length) { onClose(); return; }

    setNotice({ text: "Saving...", kind: "info" });
    try {
      const res = await api.updateTask(task.id, task.updated_at, changes);
      onUpdate(res.task || { ...task, ...changes });
      onClose();
    } catch (err) {
      if (err?.status === 409 && err?.payload?.latest) {
        onUpdate(err.payload.latest);
        setNotice({ text: "Conflict – latest state applied. Please reopen.", kind: "warn" });
        setTimeout(onClose, 1200);
      } else {
        setNotice({ text: `Save failed: ${err?.message || "unknown"}`, kind: "error" });
      }
    }
  }, [task, onUpdate, onClose]);

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete task ${task.id}?`)) return;
    setNotice({ text: "Deleting...", kind: "info" });
    try {
      await api.deleteTask(task.id, task.updated_at);
      onDelete(task.id);
      onClose();
    } catch (err) {
      if (err?.status === 409 && err?.payload?.latest) {
        onUpdate(err.payload.latest);
        setNotice({ text: "Conflict – latest state applied. Please reopen.", kind: "warn" });
        setTimeout(onClose, 1200);
      } else {
        setNotice({ text: `Delete failed: ${err?.message || "unknown"}`, kind: "error" });
      }
    }
  }, [task, onUpdate, onDelete, onClose]);

  return (
    <div class="tp-overlay" onClick={handleOverlayClick}>
      <form class="tp-panel" role="dialog" aria-label="Task detail" onSubmit={handleSave} ref={formRef}>
        <header class="tp-header">
          <span class="tp-id">{task.id}</span>
          <button class="tp-close" type="button" aria-label="Close" onClick={onClose}>&times;</button>
        </header>

        <div class="tp-body">
          <label class="tp-field">
            <span class="tp-label">Title</span>
            <input class="tp-input" name="title" type="text" defaultValue={task.title || ""} ref={titleRef} />
          </label>

          <label class="tp-field">
            <span class="tp-label">Status</span>
            <select class="tp-select" name="status" defaultValue={task.status}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          <label class="tp-field">
            <span class="tp-label">Project</span>
            <select class="tp-select" name="project_id" defaultValue={task.project_id || ""}>
              <option value="">(none)</option>
              {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>

          <label class="tp-field">
            <span class="tp-label">Scheduled</span>
            <input class="tp-input" name="scheduled_date" type="date" defaultValue={task.scheduled_date || ""} />
          </label>

          <label class="tp-field">
            <span class="tp-label">Due</span>
            <input class="tp-input" name="due_date" type="date" defaultValue={task.due_date || ""} />
          </label>

          <label class="tp-field">
            <span class="tp-label">Tags</span>
            <input class="tp-input" name="tags" type="text" defaultValue={(task.tags || []).join(", ")} placeholder="comma separated" />
          </label>

          <label class="tp-field">
            <span class="tp-label">Description</span>
            <textarea class="tp-textarea" name="description" rows="3" defaultValue={task.description || ""} />
          </label>
        </div>

        <footer class="tp-footer">
          <button class="tp-btn tp-btn-delete" type="button" onClick={handleDelete}>Delete</button>
          <div class="tp-footer-right">
            <button class="tp-btn tp-btn-cancel" type="button" onClick={onClose}>Cancel</button>
            <button class="tp-btn tp-btn-save" type="submit">Save</button>
          </div>
        </footer>

        <div class="tp-notice" aria-live="polite" data-kind={notice.kind}>{notice.text}</div>
      </form>
    </div>
  );
}
