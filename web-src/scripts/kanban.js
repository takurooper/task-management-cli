(() => {
  const dataNode = document.getElementById("web-view-data");
  const board = document.getElementById("board");
  const metaNode = document.getElementById("meta");
  const noticeNode = document.getElementById("notice");
  const searchInput = document.getElementById("searchInput");
  if (!dataNode || !board) return;

  const payload = JSON.parse(dataNode.textContent || "{}");
  const statuses = ["TODO", "IN_PROGRESS", "PENDING", "DONE"];
  const columns = {};
  for (const s of statuses) {
    columns[s] = Array.isArray(payload.columns?.[s])
      ? payload.columns[s].map((t) => ({ ...t }))
      : [];
  }

  let query = "";
  let draggingTaskId = null;

  if (metaNode) {
    metaNode.textContent = `Tasks ${payload.meta?.task_count ?? 0} / Generated ${payload.meta?.generated_at ?? "-"}`;
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function matches(task) {
    if (!query) return true;
    const tags = Array.isArray(task.tags) ? task.tags.join(" ") : "";
    return `${task.id} ${task.title || ""} ${tags}`.toLowerCase().includes(query);
  }

  function taskMeta(t) {
    const parts = [];
    if (t.due_date) parts.push(`due ${t.due_date}`);
    if (t.scheduled_date) parts.push(`scheduled ${t.scheduled_date}`);
    if (Array.isArray(t.tags) && t.tags.length) parts.push(`#${t.tags.join(" #")}`);
    return parts.join(" / ") || "-";
  }

  function findTask(taskId) {
    for (const status of statuses) {
      const idx = columns[status].findIndex((t) => t.id === taskId);
      if (idx >= 0) return { status, index: idx, task: columns[status][idx] };
    }
    return null;
  }

  function moveTaskLocal(taskId, toStatus) {
    const located = findTask(taskId);
    if (!located) return null;
    if (located.status === toStatus) return { fromStatus: toStatus, fromIndex: located.index, toStatus, task: located.task };

    const [task] = columns[located.status].splice(located.index, 1);
    task.status = toStatus;
    columns[toStatus].push(task);
    return { fromStatus: located.status, fromIndex: located.index, toStatus, task };
  }

  function rollbackMove(move) {
    if (!move || !move.task) return;
    const toCol = columns[move.toStatus];
    const idx = toCol.findIndex((t) => t.id === move.task.id);
    if (idx >= 0) toCol.splice(idx, 1);
    move.task.status = move.fromStatus;
    columns[move.fromStatus].splice(Math.min(move.fromIndex, columns[move.fromStatus].length), 0, move.task);
  }

  function replaceTask(task) {
    const located = findTask(task.id);
    if (!located) return;
    columns[located.status][located.index] = { ...task };
  }

  async function handleDrop(taskId, targetStatus) {
    const current = findTask(taskId);
    if (!current || current.status === targetStatus) return;

    const move = moveTaskLocal(taskId, targetStatus);
    render();
    showNotice(`Updating ${taskId} -> ${targetStatus} ...`, "info");

    try {
      const res = await window.TaskApi.updateTask(taskId, current.task.updated_at, { status: targetStatus });
      replaceTask(res.task);
      render();
      clearNotice();
    } catch (err) {
      rollbackMove(move);
      render();
      if (err.status === 409) {
        const latest = err.payload?.latest;
        if (latest) {
          replaceTask(latest);
          render();
        }
        showNotice(`Conflict on ${taskId}. latest state was applied.`, "warn");
      } else {
        showNotice(`Failed to update ${taskId}: ${err.message}`, "error");
      }
    }
  }

  function render() {
    board.innerHTML = "";
    for (const status of statuses) {
      const lane = document.createElement("section");
      lane.className = `lane ${status.toLowerCase().replace("_", "")}`;
      lane.dataset.status = status;

      lane.addEventListener("dragover", (event) => {
        event.preventDefault();
        lane.classList.add("droppable");
      });
      lane.addEventListener("dragleave", () => {
        lane.classList.remove("droppable");
      });
      lane.addEventListener("drop", async (event) => {
        event.preventDefault();
        lane.classList.remove("droppable");
        const taskId = event.dataTransfer?.getData("text/task-id") || draggingTaskId;
        if (!taskId) return;
        await handleDrop(taskId, status);
      });

      const header = document.createElement("h2");
      const items = (columns[status] || []).filter(matches);
      header.textContent = `${status} (${items.length})`;
      lane.appendChild(header);

      const stack = document.createElement("div");
      stack.className = "stack";

      for (const t of items) {
        const card = document.createElement("article");
        card.className = "card";
        card.draggable = true;
        card.dataset.taskId = t.id;
        card.innerHTML = `
          <div class="id">${t.id}</div>
          <h3>${escapeHtml(t.title || "")}</h3>
          <p>${taskMeta(t)}</p>
        `;

        card.addEventListener("dragstart", (event) => {
          draggingTaskId = t.id;
          card.classList.add("dragging");
          card._didDrag = true;
          if (event.dataTransfer) {
            event.dataTransfer.setData("text/task-id", t.id);
            event.dataTransfer.effectAllowed = "move";
          }
        });
        card.addEventListener("dragend", () => {
          draggingTaskId = null;
          card.classList.remove("dragging");
          document.querySelectorAll(".lane.droppable").forEach((el) => el.classList.remove("droppable"));
        });
        card.addEventListener("click", () => {
          if (card._didDrag) { card._didDrag = false; return; }
          window.TaskPopup.open(t, {
            onUpdate(updated) { replaceTask(updated); render(); },
            onDelete(id) {
              for (const s of statuses) {
                const idx = columns[s].findIndex((x) => x.id === id);
                if (idx >= 0) { columns[s].splice(idx, 1); break; }
              }
              render();
            },
          });
        });

        stack.appendChild(card);
      }
      lane.appendChild(stack);
      board.appendChild(lane);
    }
  }

  if (searchInput) {
    let timer = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        query = String(searchInput.value || "").trim().toLowerCase();
        render();
      }, 80);
    });
  }

  render();
})();
