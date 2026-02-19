(() => {
  const dataNode = document.getElementById("web-view-data");
  const svg = document.getElementById("graphSvg");
  const searchInput = document.getElementById("searchInput");
  const fitButton = document.getElementById("fitButton");
  const fullscreenButton = document.getElementById("fullscreenButton");
  const metaNode = document.getElementById("meta");
  const noticeNode = document.getElementById("notice");
  const canvasWrap = document.querySelector(".canvas-wrap");

  if (!dataNode || !svg) return;
  const graph = JSON.parse(dataNode.textContent || "{}");

  const STATUS_CLASS = {
    TODO: "todo",
    IN_PROGRESS: "inprogress",
    PENDING: "pending",
    DONE: "done",
  };

  const activeStatuses = new Set(["TODO", "IN_PROGRESS", "PENDING", "DONE"]);
  let query = "";

  const ns = "http://www.w3.org/2000/svg";
  const nodeData = new Map((graph.nodes || []).map((n) => [n.id, n]));
  const state = {
    viewBox: {
      x: graph.canvas?.x ?? 0,
      y: graph.canvas?.y ?? 0,
      w: Math.max(1, graph.canvas?.width ?? 1200),
      h: Math.max(1, graph.canvas?.height ?? 800),
    },
    drag: null,
    linkDraft: null,
  };

  svg.setAttribute("viewBox", `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.w} ${state.viewBox.h}`);

  const defs = document.createElementNS(ns, "defs");
  const marker = document.createElementNS(ns, "marker");
  marker.setAttribute("id", "edge-arrow");
  marker.setAttribute("markerWidth", "8");
  marker.setAttribute("markerHeight", "8");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "4");
  marker.setAttribute("orient", "auto");
  marker.setAttribute("markerUnits", "strokeWidth");
  const arrowPath = document.createElementNS(ns, "path");
  arrowPath.setAttribute("d", "M 0 0 L 8 4 L 0 8 z");
  arrowPath.setAttribute("class", "edge-arrow");
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const root = document.createElementNS(ns, "g");
  const groupLayer = document.createElementNS(ns, "g");
  const edgeLayer = document.createElementNS(ns, "g");
  const overlayLayer = document.createElementNS(ns, "g");
  const nodeLayer = document.createElementNS(ns, "g");
  root.append(groupLayer, edgeLayer, overlayLayer, nodeLayer);
  svg.appendChild(root);

  const nodeEls = new Map();
  const edgeEls = [];

  renderGroups();
  renderEdges();
  renderNodes();
  applyFilters();
  renderMeta();

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

  function renderMeta() {
    if (!metaNode) return;
    const mode = graph.meta?.layout_mode ? ` / ${graph.meta.layout_mode}` : "";
    metaNode.textContent = `Nodes ${graph.meta?.node_count ?? 0} / Edges ${graph.meta?.edge_count ?? 0}${mode} / Generated ${graph.meta?.generated_at ?? "-"}`;
  }

  function renderGroups() {
    for (const g of graph.groups || []) {
      const group = document.createElementNS(ns, "g");
      group.setAttribute("class", `group ${STATUS_CLASS[g.status] || "todo"}`);
      group.dataset.groupId = g.id;

      const box = document.createElementNS(ns, "rect");
      box.setAttribute("x", `${g.x}`);
      box.setAttribute("y", `${g.y}`);
      box.setAttribute("width", `${g.w}`);
      box.setAttribute("height", `${g.h}`);
      box.setAttribute("rx", "16");
      box.setAttribute("ry", "16");
      box.setAttribute("class", "group-box");

      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", `${g.x + 16}`);
      label.setAttribute("y", `${g.y + 24}`);
      label.setAttribute("class", "group-label");
      label.textContent = `${g.id}: ${g.title}`;

      group.append(box, label);
      groupLayer.appendChild(group);
    }
  }

  function edgePath(from, to) {
    const startX = from.x + from.w;
    const startY = from.y + from.h / 2;
    const endX = to.x;
    const endY = to.y + to.h / 2;
    const curve = Math.max(36, (endX - startX) * 0.4);
    return `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`;
  }

  function renderEdges() {
    edgeLayer.innerHTML = "";
    edgeEls.length = 0;
    for (const edge of graph.edges || []) {
      const from = nodeData.get(edge.from);
      const to = nodeData.get(edge.to);
      if (!from || !to) continue;
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", edgePath(from, to));
      path.setAttribute("class", "edge");
      path.setAttribute("marker-end", "url(#edge-arrow)");
      edgeLayer.appendChild(path);
      edgeEls.push({ from: edge.from, to: edge.to, el: path });
    }
  }

  function renderNodes() {
    for (const node of graph.nodes || []) {
      const g = document.createElementNS(ns, "g");
      g.setAttribute("class", `node ${STATUS_CLASS[node.status] || "todo"}`);
      g.dataset.id = node.id;
      g.dataset.status = node.status;
      g.dataset.title = String(node.title || "").toLowerCase();

      const card = document.createElementNS(ns, "rect");
      card.setAttribute("x", `${node.x}`);
      card.setAttribute("y", `${node.y}`);
      card.setAttribute("width", `${node.w}`);
      card.setAttribute("height", `${node.h}`);
      card.setAttribute("rx", "14");
      card.setAttribute("ry", "14");
      card.setAttribute("class", "node-card");

      const idLine = document.createElementNS(ns, "text");
      idLine.setAttribute("x", `${node.x + 14}`);
      idLine.setAttribute("y", `${node.y + 24}`);
      idLine.setAttribute("class", "node-id");
      idLine.textContent = node.id;

      const titleLine = document.createElementNS(ns, "text");
      titleLine.setAttribute("x", `${node.x + 14}`);
      titleLine.setAttribute("y", `${node.y + 44}`);
      titleLine.setAttribute("class", "node-title");
      wrapText(String(node.title || ""), 18, 3).forEach((line, i) => {
        const tspan = document.createElementNS(ns, "tspan");
        tspan.setAttribute("x", `${node.x + 14}`);
        tspan.setAttribute("dy", i === 0 ? "0" : "15");
        tspan.textContent = line;
        titleLine.appendChild(tspan);
      });

      const statusLine = document.createElementNS(ns, "text");
      statusLine.setAttribute("x", `${node.x + 14}`);
      statusLine.setAttribute("y", `${node.y + node.h - 14}`);
      statusLine.setAttribute("class", "node-status");
      statusLine.textContent = node.status;

      g.append(card, idLine, titleLine, statusLine);
      g.addEventListener("mousedown", onNodeMouseDown);
      g.addEventListener("mouseup", onNodeMouseUp);
      nodeLayer.appendChild(g);
      nodeEls.set(node.id, g);
    }
  }

  function truncate(text, maxLen) {
    const s = String(text || "");
    return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
  }

  function wrapText(text, charsPerLine, maxLines) {
    const plain = String(text || "").replace(/\s+/g, " ").trim();
    if (!plain) return ["-"];
    const lines = [];
    let start = 0;
    while (start < plain.length && lines.length < maxLines) {
      const end = Math.min(plain.length, start + charsPerLine);
      let chunk = plain.slice(start, end);
      start = end;
      if (start < plain.length && lines.length === maxLines - 1) {
        chunk = truncate(chunk + plain.slice(start), charsPerLine);
        start = plain.length;
      }
      lines.push(chunk);
    }
    return lines;
  }

  function nodeVisible(el) {
    const statusOk = activeStatuses.has(el.dataset.status || "TODO");
    if (!statusOk) return false;
    if (!query) return true;
    return (el.dataset.title || "").includes(query) || (el.dataset.id || "").toLowerCase().includes(query);
  }

  function applyFilters() {
    const visibleNodes = new Set();
    for (const [id, el] of nodeEls.entries()) {
      const visible = nodeVisible(el);
      el.style.display = visible ? "" : "none";
      if (visible) visibleNodes.add(id);
    }

    for (const edge of edgeEls) {
      edge.el.style.display = visibleNodes.has(edge.from) && visibleNodes.has(edge.to) ? "" : "none";
    }

    groupLayer.querySelectorAll("g.group").forEach((g) => {
      const gid = g.dataset.groupId;
      const hasVisible = (graph.nodes || []).some((n) => (n.parent_id === gid || n.id === gid) && visibleNodes.has(n.id));
      g.style.display = hasVisible ? "" : "none";
    });
  }

  function fitToGraph() {
    state.viewBox.x = graph.canvas?.x ?? 0;
    state.viewBox.y = graph.canvas?.y ?? 0;
    state.viewBox.w = Math.max(1, graph.canvas?.width ?? 1200);
    state.viewBox.h = Math.max(1, graph.canvas?.height ?? 800);
    syncViewBox();
  }

  function syncViewBox() {
    svg.setAttribute("viewBox", `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.w} ${state.viewBox.h}`);
  }

  function screenToSvg(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    return {
      x: state.viewBox.x + state.viewBox.w * ((clientX - rect.left) / rect.width),
      y: state.viewBox.y + state.viewBox.h * ((clientY - rect.top) / rect.height),
    };
  }

  function nodeExitPoint(node) {
    return { x: node.x + node.w, y: node.y + node.h / 2 };
  }

  function nodeEntryPoint(node) {
    return { x: node.x, y: node.y + node.h / 2 };
  }

  function setNodeClass(id, className, on) {
    const el = nodeEls.get(id);
    if (!el) return;
    if (on) el.classList.add(className);
    else el.classList.remove(className);
  }

  function startLinkDraft(fromId, clientX, clientY) {
    const fromNode = nodeData.get(fromId);
    if (!fromNode) return;
    cancelLinkDraft();

    const path = document.createElementNS(ns, "path");
    path.setAttribute("class", "link-draft");
    path.setAttribute("marker-end", "url(#edge-arrow)");
    overlayLayer.appendChild(path);

    state.linkDraft = { fromId, path };
    setNodeClass(fromId, "connect-source", true);
    updateLinkDraft(clientX, clientY);
    showNotice(`Link mode: drag to target node from ${fromId}`, "info");
  }

  function updateLinkDraft(clientX, clientY) {
    if (!state.linkDraft) return;
    const from = nodeData.get(state.linkDraft.fromId);
    if (!from) return;
    const p = screenToSvg(clientX, clientY);
    const start = nodeExitPoint(from);
    const end = p;
    const curve = Math.max(24, (end.x - start.x) * 0.4);
    state.linkDraft.path.setAttribute("d", `M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${end.x - curve} ${end.y}, ${end.x} ${end.y}`);
  }

  function cancelLinkDraft() {
    if (!state.linkDraft) return;
    setNodeClass(state.linkDraft.fromId, "connect-source", false);
    state.linkDraft.path.remove();
    state.linkDraft = null;
    clearNotice();
  }

  async function completeLink(toId) {
    if (!state.linkDraft) return;
    const fromId = state.linkDraft.fromId;
    if (fromId === toId) {
      cancelLinkDraft();
      return;
    }

    const toNode = nodeData.get(toId);
    if (!toNode || !toNode.updated_at) {
      showNotice(`Cannot link to ${toId}: missing updated_at`, "error");
      cancelLinkDraft();
      return;
    }

    const exists = (graph.edges || []).some((e) => e.from === fromId && e.to === toId);
    if (exists) {
      showNotice(`Link ${fromId} -> ${toId} already exists`, "warn");
      cancelLinkDraft();
      return;
    }

    showNotice(`Creating link ${fromId} -> ${toId} ...`, "info");
    try {
      const res = await window.TaskApi.linkDependency("add", fromId, toId, toNode.updated_at);
      const updated = res.task;
      if (updated?.updated_at) {
        toNode.updated_at = updated.updated_at;
      }
      if (Array.isArray(updated?.dependencies)) {
        toNode.dependencies = updated.dependencies;
      }
      graph.edges.push({ from: fromId, to: toId, type: "dependency" });
      renderEdges();
      applyFilters();
      clearNotice();
    } catch (err) {
      if (err?.status === 409 && err?.payload?.latest) {
        Object.assign(toNode, err.payload.latest);
        showNotice(`Conflict on ${toId}. latest state loaded.`, "warn");
      } else {
        showNotice(`Failed to create link: ${err?.message || "unknown error"}`, "error");
      }
    } finally {
      cancelLinkDraft();
    }
  }

  function onNodeMouseDown(event) {
    if (event.button !== 0) return;
    const id = event.currentTarget?.dataset?.id;
    if (!id) return;
    event.stopPropagation();
    event.preventDefault();
    startLinkDraft(id, event.clientX, event.clientY);
  }

  function onNodeMouseUp(event) {
    if (!state.linkDraft) return;
    const id = event.currentTarget?.dataset?.id;
    if (!id) return;
    event.stopPropagation();
    event.preventDefault();
    completeLink(id);
  }

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.08 : 0.92;
    const pointer = screenToSvg(event.clientX, event.clientY);
    const newW = Math.max(200, Math.min(12000, state.viewBox.w * factor));
    const newH = Math.max(160, Math.min(9000, state.viewBox.h * factor));
    const dx = (pointer.x - state.viewBox.x) / state.viewBox.w;
    const dy = (pointer.y - state.viewBox.y) / state.viewBox.h;
    state.viewBox.x = pointer.x - newW * dx;
    state.viewBox.y = pointer.y - newH * dy;
    state.viewBox.w = newW;
    state.viewBox.h = newH;
    syncViewBox();
  }, { passive: false });

  svg.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || state.linkDraft) return;
    state.drag = { x: event.clientX, y: event.clientY, viewX: state.viewBox.x, viewY: state.viewBox.y };
  });

  window.addEventListener("mousemove", (event) => {
    if (state.linkDraft) {
      updateLinkDraft(event.clientX, event.clientY);
      return;
    }
    if (!state.drag) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((event.clientX - state.drag.x) / rect.width) * state.viewBox.w;
    const dy = ((event.clientY - state.drag.y) / rect.height) * state.viewBox.h;
    state.viewBox.x = state.drag.viewX - dx;
    state.viewBox.y = state.drag.viewY - dy;
    syncViewBox();
  });

  window.addEventListener("mouseup", () => {
    state.drag = null;
  });

  svg.addEventListener("mouseleave", () => {
    state.drag = null;
  });

  svg.addEventListener("mouseup", (event) => {
    if (!state.linkDraft) return;
    const target = event.target;
    if (target instanceof Element && target.closest("g.node")) return;
    cancelLinkDraft();
  });

  if (searchInput) {
    let timer = null;
    searchInput.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        query = String(searchInput.value || "").trim().toLowerCase();
        applyFilters();
      }, 80);
    });
  }

  document.querySelectorAll(".status-filters input[type=checkbox]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) activeStatuses.add(checkbox.value);
      else activeStatuses.delete(checkbox.value);
      applyFilters();
    });
  });

  if (fitButton) fitButton.addEventListener("click", fitToGraph);

  function syncFullscreenButton() {
    if (!fullscreenButton) return;
    const on = document.fullscreenElement === canvasWrap;
    fullscreenButton.textContent = on ? "Exit Fullscreen" : "Fullscreen";
  }

  if (fullscreenButton && canvasWrap) {
    fullscreenButton.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement === canvasWrap) {
          await document.exitFullscreen();
        } else {
          await canvasWrap.requestFullscreen();
        }
      } catch (_e) {
        // ignore
      }
      syncFullscreenButton();
      fitToGraph();
    });
    document.addEventListener("fullscreenchange", syncFullscreenButton);
    syncFullscreenButton();
  }
})();
