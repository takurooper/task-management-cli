(() => {
  let overlay = null;
  let currentTask = null;
  let callbacks = {};
  let projectsList = [];

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function close() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    currentTask = null;
    callbacks = {};
  }

  function buildDom(task) {
    const el = document.createElement("div");
    el.className = "tp-overlay";
    el.innerHTML = `
      <div class="tp-panel" role="dialog" aria-label="Task detail">
        <header class="tp-header">
          <span class="tp-id">${escapeHtml(task.id)}</span>
          <button class="tp-close" type="button" aria-label="Close">&times;</button>
        </header>

        <div class="tp-body">
          <label class="tp-field">
            <span class="tp-label">Title</span>
            <input class="tp-input" name="title" type="text" value="${escapeHtml(task.title || "")}" />
          </label>

          <label class="tp-field">
            <span class="tp-label">Status</span>
            <select class="tp-select" name="status">
              ${["TODO", "IN_PROGRESS", "PENDING", "DONE"].map((s) => `<option value="${s}"${task.status === s ? " selected" : ""}>${s}</option>`).join("")}
            </select>
          </label>

          <label class="tp-field">
            <span class="tp-label">Project</span>
            <select class="tp-select" name="project_id">
              <option value=""${!task.project_id ? " selected" : ""}>(none)</option>
              ${projectsList.map((p) => `<option value="${escapeHtml(p.id)}"${task.project_id === p.id ? " selected" : ""}>${escapeHtml(p.title)}</option>`).join("")}
            </select>
          </label>

          <label class="tp-field">
            <span class="tp-label">Scheduled</span>
            <input class="tp-input" name="scheduled_date" type="date" value="${task.scheduled_date || ""}" />
          </label>

          <label class="tp-field">
            <span class="tp-label">Due</span>
            <input class="tp-input" name="due_date" type="date" value="${task.due_date || ""}" />
          </label>

          <label class="tp-field">
            <span class="tp-label">Tags</span>
            <input class="tp-input" name="tags" type="text" value="${escapeHtml((task.tags || []).join(", "))}" placeholder="comma separated" />
          </label>

          <label class="tp-field">
            <span class="tp-label">Description</span>
            <textarea class="tp-textarea" name="description" rows="3">${escapeHtml(task.description || "")}</textarea>
          </label>
        </div>

        <footer class="tp-footer">
          <button class="tp-btn tp-btn-delete" type="button">Delete</button>
          <div class="tp-footer-right">
            <button class="tp-btn tp-btn-cancel" type="button">Cancel</button>
            <button class="tp-btn tp-btn-save" type="button">Save</button>
          </div>
        </footer>

        <div class="tp-notice" aria-live="polite"></div>
      </div>
    `;
    return el;
  }

  function showNotice(text, kind) {
    if (!overlay) return;
    const n = overlay.querySelector(".tp-notice");
    if (!n) return;
    n.textContent = text || "";
    n.dataset.kind = kind || "";
  }

  function collectChanges() {
    if (!overlay || !currentTask) return null;
    const get = (name) => {
      const el = overlay.querySelector(`[name="${name}"]`);
      return el ? el.value : undefined;
    };
    const changes = {};
    const title = get("title");
    if (title !== undefined && title !== (currentTask.title || "")) changes.title = title;

    const status = get("status");
    if (status && status !== currentTask.status) changes.status = status;

    const projectEl = overlay.querySelector('[name="project_id"]');
    const projectId = get("project_id");
    if (projectId !== undefined) {
      const newPid = projectId || null;
      const oldPid = currentTask.project_id || null;
      const hasOldOption = !oldPid || Array.from(projectEl?.options || []).some((o) => o.value === oldPid);
      // Guard against accidental unlink when project options are missing and select falls back to "(none)".
      if (newPid !== oldPid && (newPid !== null || hasOldOption)) changes.project_id = newPid;
    }

    const scheduled = get("scheduled_date");
    if (scheduled !== undefined && scheduled !== (currentTask.scheduled_date || "")) {
      changes.scheduled_date = scheduled || null;
    }

    const due = get("due_date");
    if (due !== undefined && due !== (currentTask.due_date || "")) {
      changes.due_date = due || null;
    }

    const tagsRaw = get("tags");
    if (tagsRaw !== undefined) {
      const newTags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
      const oldTags = currentTask.tags || [];
      if (JSON.stringify(newTags) !== JSON.stringify(oldTags)) changes.tags = newTags;
    }

    const desc = get("description");
    if (desc !== undefined && desc !== (currentTask.description || "")) {
      changes.description = desc;
    }

    return Object.keys(changes).length ? changes : null;
  }

  async function handleSave() {
    const changes = collectChanges();
    if (!changes) { close(); return; }
    showNotice("Saving...", "info");
    try {
      const res = await window.TaskApi.updateTask(currentTask.id, currentTask.updated_at, changes);
      const updated = res.task || { ...currentTask, ...changes };
      if (callbacks.onUpdate) callbacks.onUpdate(updated);
      close();
    } catch (err) {
      if (err?.status === 409 && err?.payload?.latest) {
        if (callbacks.onUpdate) callbacks.onUpdate(err.payload.latest);
        showNotice("Conflict – latest state applied. Please reopen.", "warn");
        setTimeout(close, 1200);
      } else {
        showNotice(`Save failed: ${err?.message || "unknown"}`, "error");
      }
    }
  }

  async function handleDelete() {
    if (!currentTask) return;
    if (!confirm(`Delete task ${currentTask.id}?`)) return;
    showNotice("Deleting...", "info");
    try {
      await window.TaskApi.deleteTask(currentTask.id, currentTask.updated_at);
      const id = currentTask.id;
      if (callbacks.onDelete) callbacks.onDelete(id);
      close();
    } catch (err) {
      if (err?.status === 409 && err?.payload?.latest) {
        if (callbacks.onUpdate) callbacks.onUpdate(err.payload.latest);
        showNotice("Conflict – latest state applied. Please reopen.", "warn");
        setTimeout(close, 1200);
      } else {
        showNotice(`Delete failed: ${err?.message || "unknown"}`, "error");
      }
    }
  }

  function open(task, cbs) {
    close();
    currentTask = { ...task };
    callbacks = cbs || {};
    projectsList = (cbs && cbs.projects) || window._projects || [];
    overlay = buildDom(currentTask);
    document.body.appendChild(overlay);

    overlay.querySelector(".tp-close").addEventListener("click", close);
    overlay.querySelector(".tp-btn-cancel").addEventListener("click", close);
    overlay.querySelector(".tp-btn-save").addEventListener("click", handleSave);
    overlay.querySelector(".tp-btn-delete").addEventListener("click", handleDelete);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);

    const titleInput = overlay.querySelector('[name="title"]');
    if (titleInput) titleInput.focus();
  }

  function onKey(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
  }

  window.TaskPopup = { open, close };
})();
