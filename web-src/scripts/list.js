(() => {
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function renderMeta(t) {
    const parts = [];
    if (t.due_date) parts.push(`due ${t.due_date}`);
    if (t.scheduled_date) parts.push(`scheduled ${t.scheduled_date}`);
    if (Array.isArray(t.tags) && t.tags.length) parts.push(`#${t.tags.join(" #")}`);
    return parts.join(" / ") || "-";
  }

  function createInstance(container, payload, callbacks) {
    const tasks = (payload.tasks || []).map((t) => ({ ...t }));
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const projects = payload.projects || [];
    const activeStatuses = new Set(["TODO", "IN_PROGRESS", "PENDING", "DONE"]);
    let query = callbacks?.initialQuery || "";
    let draggingTaskId = null;

    if (callbacks?.initialStatuses) {
      activeStatuses.clear();
      callbacks.initialStatuses.forEach((s) => activeStatuses.add(s));
    }

    container.innerHTML = `
      <section class="controls">
        <label class="field search">
          <span>Search</span>
          <input class="lv-search" type="search" placeholder="task id / title / tag" />
        </label>
        <fieldset class="status-filters">
          <legend>Status</legend>
          ${["TODO", "IN_PROGRESS", "PENDING", "DONE"].map((s) => `<label><input type="checkbox" value="${s}"${activeStatuses.has(s) ? " checked" : ""} />${s}</label>`).join("")}
        </fieldset>
      </section>
      <section class="lv-notice notice" aria-live="polite"></section>
      <section class="lv-root list-root"></section>
    `;
    const root = container.querySelector(".lv-root");
    const noticeNode = container.querySelector(".lv-notice");
    const searchInput = container.querySelector(".lv-search");
    if (searchInput && query) searchInput.value = query;

    function token(task) {
      const tags = Array.isArray(task.tags) ? task.tags.join(" ") : "";
      return `${task.id} ${task.title || ""} ${tags}`.toLowerCase();
    }

    function visible(task) {
      if (!activeStatuses.has(task.status)) return false;
      if (!query) return true;
      return token(task).includes(query);
    }

    function showNotice(text, kind = "info") {
      if (!noticeNode) return;
      noticeNode.textContent = text || "";
      noticeNode.dataset.kind = kind;
    }

    function clearNotice() {
      if (!noticeNode) return;
      noticeNode.textContent = "";
      noticeNode.dataset.kind = "";
    }

    function notifyDataChanged() {
      if (callbacks?.onDataChanged) callbacks.onDataChanged();
    }

    function render() {
      root.innerHTML = "";
      const grouped = { TODO: [], IN_PROGRESS: [], PENDING: [], DONE: [] };
      for (const t of tasks) {
        if (visible(t)) grouped[t.status]?.push(t);
      }

      for (const status of ["TODO", "IN_PROGRESS", "PENDING", "DONE"]) {
        const section = document.createElement("section");
        section.className = "status-section";
        section.dataset.status = status;

        section.addEventListener("dragover", (event) => {
          event.preventDefault();
          section.classList.add("droppable");
        });
        section.addEventListener("dragleave", () => {
          section.classList.remove("droppable");
        });
        section.addEventListener("drop", async (event) => {
          event.preventDefault();
          section.classList.remove("droppable");
          const taskId = event.dataTransfer?.getData("text/task-id") || draggingTaskId;
          if (!taskId) return;
          await handleDrop(taskId, status);
        });

        const h = document.createElement("h2");
        h.textContent = `${status} (${grouped[status].length})`;
        section.appendChild(h);

        const list = document.createElement("ul");
        list.className = "task-list";

        for (const t of grouped[status]) {
          const row = document.createElement("li");
          row.className = `task-row ${status.toLowerCase().replace("_", "")}`;
          row.draggable = true;
          row.dataset.taskId = t.id;
          row.innerHTML = `
            <div class="main-line">
              <span class="id">${t.id}</span>
              <span class="title">${escapeHtml(t.title || "")}</span>
            </div>
            <div class="sub-line">${escapeHtml(renderMeta(t))}</div>
          `;
          row.addEventListener("dragstart", (event) => {
            draggingTaskId = t.id;
            row.classList.add("dragging");
            row._didDrag = true;
            if (event.dataTransfer) {
              event.dataTransfer.setData("text/task-id", t.id);
              event.dataTransfer.effectAllowed = "move";
            }
          });
          row.addEventListener("dragend", () => {
            draggingTaskId = null;
            row.classList.remove("dragging");
            container.querySelectorAll(".status-section.droppable").forEach((el) => el.classList.remove("droppable"));
          });
          row.addEventListener("click", () => {
            if (row._didDrag) { row._didDrag = false; return; }
            window.TaskPopup.open(t, {
              projects,
              onUpdate(updated) { Object.assign(t, updated); render(); notifyDataChanged(); },
              onDelete() { const idx = tasks.indexOf(t); if (idx >= 0) tasks.splice(idx, 1); taskMap.delete(t.id); render(); notifyDataChanged(); },
            });
          });
          list.appendChild(row);
        }
        section.appendChild(list);
        root.appendChild(section);
      }
    }

    function moveTaskLocal(taskId, toStatus) {
      const task = taskMap.get(taskId);
      if (!task) return null;
      const fromStatus = task.status;
      if (fromStatus === toStatus) return { task, fromStatus, toStatus };
      task.status = toStatus;
      return { task, fromStatus, toStatus };
    }

    async function handleDrop(taskId, targetStatus) {
      const task = taskMap.get(taskId);
      if (!task || task.status === targetStatus) return;
      const expectedUpdatedAt = task.updated_at;
      const moved = moveTaskLocal(taskId, targetStatus);
      render();
      showNotice(`Updating ${taskId} -> ${targetStatus} ...`, "info");

      try {
        const res = await window.TaskApi.updateTask(taskId, expectedUpdatedAt, { status: targetStatus });
        const latest = res.task || task;
        Object.assign(task, latest);
        render();
        clearNotice();
        notifyDataChanged();
      } catch (err) {
        if (moved?.task) {
          moved.task.status = moved.fromStatus;
        }
        if (err?.status === 409 && err?.payload?.latest) {
          Object.assign(task, err.payload.latest);
          showNotice(`Conflict on ${taskId}. latest state was applied.`, "warn");
        } else {
          showNotice(`Failed to update ${taskId}: ${err?.message || "unknown error"}`, "error");
        }
        render();
      }
    }

    container.querySelectorAll(".status-filters input[type=checkbox]").forEach((el) => {
      el.addEventListener("change", () => {
        if (el.checked) activeStatuses.add(el.value);
        else activeStatuses.delete(el.value);
        render();
      });
    });

    let timer = null;
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          query = String(searchInput.value || "").trim().toLowerCase();
          render();
        }, 80);
      });
    }

    render();

    return {
      getQuery() { return query; },
      getStatuses() { return [...activeStatuses]; },
      destroy() { clearTimeout(timer); container.innerHTML = ""; },
    };
  }

  // SPA module
  window.ListView = {
    init(container, data, callbacks) {
      return createInstance(container, data, callbacks);
    },
  };

  // Standalone mode
  const dataNode = document.getElementById("web-view-data");
  if (dataNode) {
    const container = document.getElementById("listViewContainer");
    if (container) {
      const payload = JSON.parse(dataNode.textContent || "{}");
      createInstance(container, payload, null);
    }
  }
})();
