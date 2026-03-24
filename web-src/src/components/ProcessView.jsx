import { h } from "preact";
import { useState, useRef, useEffect, useCallback } from "preact/hooks";
import * as api from "../api/client";
import { TaskPopup } from "./TaskPopup";

const STATUSES = ["TODO", "IN_PROGRESS", "PENDING", "DONE"];
const STATUS_CLASS = { TODO: "todo", IN_PROGRESS: "inprogress", PENDING: "pending", DONE: "done" };
const ns = "http://www.w3.org/2000/svg";

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

// Layout constants (must match task.py _layout_process_graph)
const LAYOUT = {
  nodeW: 280, nodeH: 116, colGap: 44, stackGap: 20, rowGap: 36,
  marginX: 56, marginY: 72, labelColW: 220, rowHeaderH: 34, rowPadX: 18, rowPadY: 16,
};

function layoutGraph(visibleIds, allEdges, allGroups) {
  const { nodeW, nodeH, colGap, stackGap, rowGap, marginX, marginY, labelColW, rowHeaderH, rowPadX, rowPadY } = LAYOUT;
  const visSet = new Set(visibleIds);
  const edgesByTo = {};
  for (const e of allEdges) {
    if (visSet.has(e.from) && visSet.has(e.to)) {
      (edgesByTo[e.to] ||= []).push(e.from);
    }
  }

  const positions = {};  // id -> {x, y, w, h}
  const groupPositions = {};  // groupId -> {x, y, w, h}
  let maxRight = marginX;
  let rowTop = marginY;

  // Grouped nodes
  for (const grp of [...allGroups].sort((a, b) => a.id < b.id ? -1 : 1)) {
    const members = (grp.members || []).filter((m) => visSet.has(m)).sort();
    if (!members.length) { groupPositions[grp.id] = null; continue; }

    const cols = {};
    const rootId = grp.id;
    if (members.includes(rootId)) cols[rootId] = 0;
    let unresolved = members.filter((m) => m !== rootId);

    for (let iter = 0; iter < unresolved.length + 2; iter++) {
      const next = [];
      let progressed = false;
      for (const tid of unresolved) {
        const intraDeps = (edgesByTo[tid] || []).filter((d) => members.includes(d));
        if (!intraDeps.length) { cols[tid] = 0; progressed = true; continue; }
        if (intraDeps.every((d) => d in cols)) { cols[tid] = Math.max(...intraDeps.map((d) => cols[d])) + 1; progressed = true; }
        else next.push(tid);
      }
      unresolved = next;
      if (!progressed) break;
    }
    for (const tid of unresolved) {
      const intra = (edgesByTo[tid] || []).filter((d) => d in cols);
      cols[tid] = intra.length ? Math.max(...intra.map((d) => cols[d])) + 1 : 0;
    }

    const membersByCol = {};
    for (const m of members) (membersByCol[cols[m] ?? 0] ||= []).push(m);
    for (const col in membersByCol) membersByCol[col].sort((a, b) => (a !== rootId ? 1 : 0) - (b !== rootId ? 1 : 0) || (a < b ? -1 : 1));

    const maxCol = Math.max(...Object.keys(membersByCol).map(Number));
    const maxStack = Math.max(...Object.values(membersByCol).map((a) => a.length));
    const gx = marginX, gy = rowTop;
    const gw = labelColW + rowPadX * 2 + Math.max(0, (maxCol + 1) * nodeW) + Math.max(0, maxCol * colGap);
    const gh = rowHeaderH + rowPadY * 2 + Math.max(0, maxStack * nodeH) + Math.max(0, (maxStack - 1) * stackGap);

    const baseX = gx + labelColW + rowPadX;
    const baseY = gy + rowHeaderH + rowPadY;
    for (const col of Object.keys(membersByCol).map(Number).sort((a, b) => a - b)) {
      membersByCol[col].forEach((tid, slot) => {
        positions[tid] = { x: baseX + col * (nodeW + colGap), y: baseY + slot * (nodeH + stackGap), w: nodeW, h: nodeH };
      });
    }
    groupPositions[grp.id] = { x: gx, y: gy, w: gw, h: gh };
    maxRight = Math.max(maxRight, gx + gw);
    rowTop += gh + rowGap;
  }

  // Ungrouped nodes
  const groupedIds = new Set();
  for (const g of allGroups) (g.members || []).forEach((m) => groupedIds.add(m));
  const ungrouped = visibleIds.filter((id) => !groupedIds.has(id)).sort();

  if (ungrouped.length) {
    const ugSet = new Set(ungrouped);
    const ugAdj = {};
    for (const tid of ungrouped) ugAdj[tid] = new Set();
    for (const e of allEdges) {
      if (ugSet.has(e.from) && ugSet.has(e.to)) { ugAdj[e.from].add(e.to); ugAdj[e.to].add(e.from); }
    }
    const visited = new Set();
    const components = [];
    for (const tid of ungrouped) {
      if (visited.has(tid)) continue;
      const queue = [tid]; visited.add(tid); const comp = [];
      while (queue.length) { const cur = queue.shift(); comp.push(cur); for (const nb of [...ugAdj[cur]].sort()) { if (!visited.has(nb)) { visited.add(nb); queue.push(nb); } } }
      components.push(comp);
    }
    const chains = components.filter((c) => c.length > 1);
    const singletons = components.filter((c) => c.length === 1).map((c) => c[0]).sort();

    for (const comp of chains) {
      const compSet = new Set(comp);
      const cols = {};
      let remaining = [...comp];
      for (let iter = 0; iter < remaining.length + 2; iter++) {
        const nxt = [];
        for (const tid of remaining) {
          const intra = (edgesByTo[tid] || []).filter((d) => compSet.has(d));
          if (!intra.length) cols[tid] = 0;
          else if (intra.every((d) => d in cols)) cols[tid] = Math.max(...intra.map((d) => cols[d])) + 1;
          else nxt.push(tid);
        }
        remaining = nxt;
        if (!remaining.length) break;
      }
      for (const tid of remaining) cols[tid] = 0;

      const membersByCol = {};
      for (const tid of comp) (membersByCol[cols[tid]] ||= []).push(tid);
      const maxStack = Math.max(...Object.values(membersByCol).map((a) => a.length));
      for (const ci of Object.keys(membersByCol).map(Number).sort((a, b) => a - b)) {
        membersByCol[ci].forEach((tid, slot) => {
          positions[tid] = { x: marginX + ci * (nodeW + colGap), y: rowTop + slot * (nodeH + stackGap), w: nodeW, h: nodeH };
          maxRight = Math.max(maxRight, positions[tid].x + nodeW);
        });
      }
      rowTop += maxStack * nodeH + Math.max(0, (maxStack - 1) * stackGap) + rowGap;
    }

    if (singletons.length) {
      const gridCols = 3;
      for (let i = 0; i < singletons.length; i++) {
        const gc = i % gridCols, gr = Math.floor(i / gridCols);
        positions[singletons[i]] = { x: marginX + gc * (nodeW + colGap), y: rowTop + gr * (nodeH + stackGap), w: nodeW, h: nodeH };
        maxRight = Math.max(maxRight, positions[singletons[i]].x + nodeW);
      }
      const numRows = Math.ceil(singletons.length / gridCols);
      rowTop += numRows * nodeH + Math.max(0, (numRows - 1) * stackGap) + rowGap;
    }
  }

  return { positions, groupPositions, canvas: { x: 0, y: 0, width: maxRight + marginX, height: rowTop + marginY } };
}

export function ProcessView({ data: graph, projects, onDataChanged }) {
  const [activeStatuses, setActiveStatuses] = useState(() => new Set(STATUSES));
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState({ text: "", kind: "" });
  const [popupTask, setPopupTask] = useState(null);
  const svgRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const timerRef = useRef(null);
  const graphStateRef = useRef(null);

  // Initialize SVG graph (imperative, runs once per data)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.innerHTML = "";

    const nodeData = new Map((graph.nodes || []).map((n) => [n.id, { ...n }]));
    const state = {
      viewBox: {
        x: graph.canvas?.x ?? 0, y: graph.canvas?.y ?? 0,
        w: Math.max(1, graph.canvas?.width ?? 1200),
        h: Math.max(1, graph.canvas?.height ?? 800),
      },
      drag: null, linkDraft: null, nodeClick: null,
    };
    const nodeEls = new Map();
    const edgeEls = [];
    const groupEls = new Map();

    svg.setAttribute("viewBox", `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.w} ${state.viewBox.h}`);

    // Arrow marker
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

    function syncViewBox() {
      svg.setAttribute("viewBox", `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.w} ${state.viewBox.h}`);
    }

    function screenToSvg(cx, cy) {
      const rect = svg.getBoundingClientRect();
      return {
        x: state.viewBox.x + state.viewBox.w * ((cx - rect.left) / rect.width),
        y: state.viewBox.y + state.viewBox.h * ((cy - rect.top) / rect.height),
      };
    }

    function nodeExitPoint(node) { return { x: node.x + node.w, y: node.y + node.h / 2 }; }

    function setNodeClass(id, className, on) {
      const el = nodeEls.get(id);
      if (el) el.classList.toggle(className, on);
    }

    function edgePath(from, to) {
      const sx = from.x + from.w, sy = from.y + from.h / 2;
      const ex = to.x, ey = to.y + to.h / 2;

      // ターゲットが右側にある通常ケース: 水平ベジエ曲線
      if (ex >= sx) {
        const curve = Math.max(36, (ex - sx) * 0.4);
        return `M ${sx} ${sy} C ${sx + curve} ${sy}, ${ex - curve} ${ey}, ${ex} ${ey}`;
      }

      // ターゲットが左側にある逆行ケース:
      // ソースの下辺中央 → ターゲットの上辺中央 へ垂直方向でルーティング
      const fromBx = from.x + from.w / 2;
      const fromBy = from.y + from.h;
      const toBx = to.x + to.w / 2;
      const toBy = to.y;
      const dy = Math.max(44, Math.abs(toBy - fromBy) * 0.45);
      return `M ${fromBx} ${fromBy} C ${fromBx} ${fromBy + dy}, ${toBx} ${toBy - dy}, ${toBx} ${toBy}`;
    }

    function renderEdges() {
      edgeLayer.innerHTML = "";
      edgeEls.length = 0;
      for (const edge of graph.edges || []) {
        const from = nodeData.get(edge.from), to = nodeData.get(edge.to);
        if (!from || !to) continue;
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", edgePath(from, to));
        path.setAttribute("class", "edge");
        path.setAttribute("marker-end", "url(#edge-arrow)");
        edgeLayer.appendChild(path);
        edgeEls.push({ from: edge.from, to: edge.to, el: path });
      }
    }

    function startLinkDraft(fromId, cx, cy) {
      const fromNode = nodeData.get(fromId);
      if (!fromNode) return;
      cancelLinkDraft();
      const path = document.createElementNS(ns, "path");
      path.setAttribute("class", "link-draft");
      path.setAttribute("marker-end", "url(#edge-arrow)");
      overlayLayer.appendChild(path);
      state.linkDraft = { fromId, path };
      setNodeClass(fromId, "connect-source", true);
      updateLinkDraft(cx, cy);
      setNotice({ text: `Link mode: drag to target node from ${fromId}`, kind: "info" });
    }

    function updateLinkDraft(cx, cy) {
      if (!state.linkDraft) return;
      const from = nodeData.get(state.linkDraft.fromId);
      if (!from) return;
      const start = nodeExitPoint(from);
      const end = screenToSvg(cx, cy);
      const curve = Math.max(24, (end.x - start.x) * 0.4);
      state.linkDraft.path.setAttribute("d", `M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${end.x - curve} ${end.y}, ${end.x} ${end.y}`);
    }

    function cancelLinkDraft() {
      if (!state.linkDraft) return;
      setNodeClass(state.linkDraft.fromId, "connect-source", false);
      state.linkDraft.path.remove();
      state.linkDraft = null;
      setNotice({ text: "", kind: "" });
    }

    async function completeLink(toId) {
      if (!state.linkDraft) return;
      const fromId = state.linkDraft.fromId;
      if (fromId === toId) { cancelLinkDraft(); return; }
      const toNode = nodeData.get(toId);
      if (!toNode?.updated_at) {
        setNotice({ text: `Cannot link to ${toId}: missing updated_at`, kind: "error" });
        cancelLinkDraft();
        return;
      }
      if ((graph.edges || []).some((e) => e.from === fromId && e.to === toId)) {
        setNotice({ text: `Link ${fromId} -> ${toId} already exists`, kind: "warn" });
        cancelLinkDraft();
        return;
      }
      setNotice({ text: `Creating link ${fromId} -> ${toId} ...`, kind: "info" });
      try {
        const res = await api.linkDependency("add", fromId, toId, toNode.updated_at);
        const updated = res.task;
        if (updated?.updated_at) toNode.updated_at = updated.updated_at;
        if (Array.isArray(updated?.dependencies)) toNode.dependencies = updated.dependencies;
        graph.edges.push({ from: fromId, to: toId, type: "dependency" });
        renderEdges();
        applyFilters();
        setNotice({ text: "", kind: "" });
        onDataChanged?.();
      } catch (err) {
        if (err?.status === 409 && err?.payload?.latest) {
          Object.assign(toNode, err.payload.latest);
          setNotice({ text: `Conflict on ${toId}. latest state loaded.`, kind: "warn" });
        } else {
          setNotice({ text: `Failed to create link: ${err?.message || "unknown error"}`, kind: "error" });
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
      state.nodeClick = { id, x: event.clientX, y: event.clientY, moved: false };
    }

    function onNodeMouseUp(event) {
      const click = state.nodeClick;
      state.nodeClick = null;
      if (state.linkDraft) {
        const id = event.currentTarget?.dataset?.id;
        if (!id) return;
        event.stopPropagation();
        event.preventDefault();
        completeLink(id);
        return;
      }
      if (click && !click.moved) {
        const node = nodeData.get(click.id);
        if (!node) return;
        event.stopPropagation();
        event.preventDefault();
        setPopupTask({ ...node });
      }
    }

    // Render groups
    for (const g of graph.groups || []) {
      const group = document.createElementNS(ns, "g");
      group.setAttribute("class", "group todo");
      group.dataset.groupId = g.id;
      const box = document.createElementNS(ns, "rect");
      box.setAttribute("x", `${g.x}`); box.setAttribute("y", `${g.y}`);
      box.setAttribute("width", `${g.w}`); box.setAttribute("height", `${g.h}`);
      box.setAttribute("rx", "16"); box.setAttribute("ry", "16");
      box.setAttribute("class", "group-box");
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", `${g.x + 16}`); label.setAttribute("y", `${g.y + 24}`);
      label.setAttribute("class", "group-label");
      label.textContent = `${g.id}: ${g.title}`;
      group.append(box, label);
      groupLayer.appendChild(group);
      groupEls.set(g.id, { el: group, box, label });
    }

    renderEdges();

    // Render nodes
    for (const node of graph.nodes || []) {
      const g = document.createElementNS(ns, "g");
      g.setAttribute("class", `node ${STATUS_CLASS[node.status] || "todo"}`);
      g.dataset.id = node.id;
      g.dataset.status = node.status;
      g.dataset.title = String(node.title || "").toLowerCase();

      const card = document.createElementNS(ns, "rect");
      card.setAttribute("x", `${node.x}`); card.setAttribute("y", `${node.y}`);
      card.setAttribute("width", `${node.w}`); card.setAttribute("height", `${node.h}`);
      card.setAttribute("rx", "14"); card.setAttribute("ry", "14");
      card.setAttribute("class", "node-card");

      const idLine = document.createElementNS(ns, "text");
      idLine.setAttribute("x", `${node.x + 14}`); idLine.setAttribute("y", `${node.y + 24}`);
      idLine.setAttribute("class", "node-id");
      idLine.textContent = node.id;

      const titleLine = document.createElementNS(ns, "text");
      titleLine.setAttribute("x", `${node.x + 14}`); titleLine.setAttribute("y", `${node.y + 44}`);
      titleLine.setAttribute("class", "node-title");
      wrapText(String(node.title || ""), 18, 3).forEach((line, i) => {
        const tspan = document.createElementNS(ns, "tspan");
        tspan.setAttribute("x", `${node.x + 14}`);
        tspan.setAttribute("dy", i === 0 ? "0" : "15");
        tspan.textContent = line;
        titleLine.appendChild(tspan);
      });

      const statusLine = document.createElementNS(ns, "text");
      statusLine.setAttribute("x", `${node.x + 14}`); statusLine.setAttribute("y", `${node.y + node.h - 14}`);
      statusLine.setAttribute("class", "node-status");
      statusLine.textContent = node.status;

      g.append(card, idLine, titleLine, statusLine);
      g.addEventListener("mousedown", onNodeMouseDown);
      g.addEventListener("mouseup", onNodeMouseUp);
      nodeLayer.appendChild(g);
      nodeEls.set(node.id, g);
    }

    function repositionNode(id, pos) {
      const el = nodeEls.get(id);
      if (!el) return;
      const card = el.querySelector(".node-card");
      if (card) { card.setAttribute("x", pos.x); card.setAttribute("y", pos.y); card.setAttribute("width", pos.w); card.setAttribute("height", pos.h); }
      const idText = el.querySelector(".node-id");
      if (idText) { idText.setAttribute("x", pos.x + 14); idText.setAttribute("y", pos.y + 24); }
      const titleText = el.querySelector(".node-title");
      if (titleText) {
        titleText.setAttribute("x", pos.x + 14); titleText.setAttribute("y", pos.y + 44);
        titleText.querySelectorAll("tspan").forEach((ts) => ts.setAttribute("x", pos.x + 14));
      }
      const statusText = el.querySelector(".node-status");
      if (statusText) { statusText.setAttribute("x", pos.x + 14); statusText.setAttribute("y", pos.y + pos.h - 14); }
      // Update nodeData so edgePath uses new positions
      const nd = nodeData.get(id);
      if (nd) { nd.x = pos.x; nd.y = pos.y; nd.w = pos.w; nd.h = pos.h; }
    }

    function applyNodeUpdate(updated) {
      const node = nodeData.get(updated.id);
      if (!node) return;
      Object.assign(node, updated);
      const el = nodeEls.get(updated.id);
      if (!el) return;
      const status = node.status || "TODO";
      el.setAttribute("class", `node ${STATUS_CLASS[status] || "todo"}`);
      el.dataset.status = status;
      el.dataset.title = String(node.title || "").toLowerCase();
      const titleText = el.querySelector(".node-title");
      if (titleText) {
        titleText.innerHTML = "";
        wrapText(String(node.title || ""), 18, 3).forEach((line, i) => {
          const tspan = document.createElementNS(ns, "tspan");
          tspan.setAttribute("x", `${node.x + 14}`);
          tspan.setAttribute("dy", i === 0 ? "0" : "15");
          tspan.textContent = line;
          titleText.appendChild(tspan);
        });
      }
      const statusText = el.querySelector(".node-status");
      if (statusText) {
        statusText.textContent = status;
      }
    }

    function applyFilters() {
      const currentQuery = graphStateRef.current?.query ?? "";
      const currentStatuses = graphStateRef.current?.activeStatuses ?? new Set(STATUSES);
      const visibleIds = [];
      for (const [id, el] of nodeEls.entries()) {
        const statusOk = currentStatuses.has(el.dataset.status || "TODO");
        const queryOk = !currentQuery || (el.dataset.title || "").includes(currentQuery) || (el.dataset.id || "").toLowerCase().includes(currentQuery);
        const visible = statusOk && queryOk;
        el.style.display = visible ? "" : "none";
        if (visible) visibleIds.push(id);
      }
      const visibleSet = new Set(visibleIds);

      // Re-layout visible nodes
      const result = layoutGraph(visibleIds, graph.edges || [], graph.groups || []);

      // Reposition visible nodes
      for (const id of visibleIds) {
        const pos = result.positions[id];
        if (pos) repositionNode(id, pos);
      }

      // Reposition group boxes
      for (const [gid, ge] of groupEls.entries()) {
        const gp = result.groupPositions[gid];
        if (!gp) { ge.el.style.display = "none"; continue; }
        ge.el.style.display = "";
        ge.box.setAttribute("x", gp.x); ge.box.setAttribute("y", gp.y);
        ge.box.setAttribute("width", gp.w); ge.box.setAttribute("height", gp.h);
        ge.label.setAttribute("x", gp.x + 16); ge.label.setAttribute("y", gp.y + 24);
      }

      // Re-render edges with new positions
      edgeLayer.innerHTML = "";
      edgeEls.length = 0;
      for (const edge of graph.edges || []) {
        if (!visibleSet.has(edge.from) || !visibleSet.has(edge.to)) continue;
        const from = nodeData.get(edge.from), to = nodeData.get(edge.to);
        if (!from || !to) continue;
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", edgePath(from, to));
        path.setAttribute("class", "edge");
        path.setAttribute("marker-end", "url(#edge-arrow)");
        edgeLayer.appendChild(path);
        edgeEls.push({ from: edge.from, to: edge.to, el: path });
      }

      // 計算済み canvas を保存しておき Fit ボタンから再利用できるようにする
      if (graphStateRef.current) graphStateRef.current.lastCanvas = result.canvas;

      // キャンバス全体が SVG ピクセル領域に収まるよう viewBox を再計算して適用する
      fitCanvasToView(result.canvas);
    }

    // SVG のピクセルサイズに合わせて canvas 全体が収まる viewBox を計算・適用する。
    // preserveAspectRatio の "meet" 相当を手動で計算し、余白を加えてセンタリングする。
    function fitCanvasToView(canvas) {
      const pad = 32; // SVG 座標系での余白
      const contentW = canvas.width + pad * 2;
      const contentH = canvas.height + pad * 2;
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return; // SVG 未レイアウト時はスキップ

      const svgAspect = rect.width / rect.height;
      const contentAspect = contentW / contentH;

      let vbW, vbH;
      if (contentAspect > svgAspect) {
        // 横方向が制限：viewBox 幅を contentW に合わせ、高さを SVG アスペクト比で補完
        vbW = contentW;
        vbH = contentW / svgAspect;
      } else {
        // 縦方向が制限：viewBox 高さを contentH に合わせ、幅を SVG アスペクト比で補完
        vbH = contentH;
        vbW = contentH * svgAspect;
      }

      // canvas をセンタリングして余白を均等に分配
      state.viewBox.x = (canvas.x - pad) - (vbW - contentW) / 2;
      state.viewBox.y = (canvas.y - pad) - (vbH - contentH) / 2;
      state.viewBox.w = Math.max(1, vbW);
      state.viewBox.h = Math.max(1, vbH);
      syncViewBox();
    }

    function fitToGraph() {
      // 最後に計算した canvas を使って再フィット
      const gs = graphStateRef.current;
      if (gs?.lastCanvas) fitCanvasToView(gs.lastCanvas);
      else applyFilters();
    }

    // SVG event handlers
    function onWheel(event) {
      event.preventDefault();
      if (event.ctrlKey) {
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
      } else {
        const rect = svg.getBoundingClientRect();
        state.viewBox.x += (event.deltaX / rect.width) * state.viewBox.w;
        state.viewBox.y += (event.deltaY / rect.height) * state.viewBox.h;
      }
      syncViewBox();
    }

    function onSvgMouseDown(event) {
      if (event.button !== 0 || state.linkDraft) return;
      state.drag = { x: event.clientX, y: event.clientY, viewX: state.viewBox.x, viewY: state.viewBox.y };
    }

    function onMouseMove(event) {
      if (state.nodeClick && !state.nodeClick.moved) {
        const dx = event.clientX - state.nodeClick.x;
        const dy = event.clientY - state.nodeClick.y;
        if (dx * dx + dy * dy > 25) {
          state.nodeClick.moved = true;
          startLinkDraft(state.nodeClick.id, state.nodeClick.x, state.nodeClick.y);
        }
      }
      if (state.linkDraft) { updateLinkDraft(event.clientX, event.clientY); return; }
      if (!state.drag) return;
      const rect = svg.getBoundingClientRect();
      const dx = ((event.clientX - state.drag.x) / rect.width) * state.viewBox.w;
      const dy = ((event.clientY - state.drag.y) / rect.height) * state.viewBox.h;
      state.viewBox.x = state.drag.viewX - dx;
      state.viewBox.y = state.drag.viewY - dy;
      syncViewBox();
    }

    function onMouseUp() { state.drag = null; }
    function onSvgMouseLeave() { state.drag = null; }
    function onSvgMouseUp(event) {
      if (!state.linkDraft) return;
      const target = event.target;
      if (target instanceof Element && target.closest("g.node")) return;
      cancelLinkDraft();
    }

    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("mousedown", onSvgMouseDown);
    svg.addEventListener("mouseleave", onSvgMouseLeave);
    svg.addEventListener("mouseup", onSvgMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    // Store refs for filter sync and fit
    graphStateRef.current = { applyFilters, fitToGraph, nodeData, nodeEls, renderEdges, applyNodeUpdate, activeStatuses, query, lastCanvas: null };

    // 初回はノードをレイアウトしてから rAF で fit を実行する。
    // useEffect 内では SVG がまだブラウザにレイアウトされておらず getBoundingClientRect() が
    // 0 を返す場合があるため、1 フレーム後に fitCanvasToView を再実行する。
    applyFilters();
    const rafId = requestAnimationFrame(() => {
      const gs = graphStateRef.current;
      if (gs?.lastCanvas) fitCanvasToView(gs.lastCanvas);
    });

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      svg.innerHTML = "";
    };
  }, [graph]);

  // Sync filters when query/statuses change
  useEffect(() => {
    if (graphStateRef.current) {
      graphStateRef.current.query = query;
      graphStateRef.current.activeStatuses = activeStatuses;
      graphStateRef.current.applyFilters();
    }
  }, [query, activeStatuses]);

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
      if (checked) next.add(status); else next.delete(status);
      return next;
    });
  }, []);

  const handleFit = useCallback(() => {
    graphStateRef.current?.fitToGraph();
  }, []);

  const handleFullscreen = useCallback(async () => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    try {
      if (document.fullscreenElement === wrap) await document.exitFullscreen();
      else await wrap.requestFullscreen();
    } catch (_e) { /* ignore */ }
    graphStateRef.current?.fitToGraph();
  }, []);

  const handlePopupUpdate = useCallback((updated) => {
    const gs = graphStateRef.current;
    if (gs) {
      gs.applyNodeUpdate?.(updated);
      gs.applyFilters?.();
    }
    setPopupTask(null);
    onDataChanged?.();
  }, [onDataChanged]);

  const handlePopupDelete = useCallback((id) => {
    const gs = graphStateRef.current;
    if (gs) {
      const el = gs.nodeEls?.get(id);
      if (el) {
        el.remove();
        gs.nodeEls.delete(id);
      }
      if (Array.isArray(graph.edges)) {
        graph.edges = graph.edges.filter((e) => e.from !== id && e.to !== id);
      }
      gs.nodeData?.delete(id);
      gs.renderEdges?.();
      gs.applyFilters?.();
    }
    setPopupTask(null);
    onDataChanged?.();
  }, [graph, onDataChanged]);

  return (
    <div>
      <section class="controls" aria-label="Controls">
        <label class="field search">
          <span>Search</span>
          <input class="pv-search" type="search" placeholder="task id / title" onInput={handleSearch} />
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
        <div class="actions">
          <button type="button" onClick={handleFit}>Fit</button>
          <button type="button" onClick={handleFullscreen}>Fullscreen</button>
        </div>
      </section>

      <section class="notice" aria-live="polite" data-kind={notice.kind}>{notice.text}</section>

      <section class="canvas-wrap" ref={canvasWrapRef}>
        <svg id="graphSvg" ref={svgRef} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Task process graph" />
      </section>

      <footer class="legend" aria-label="Legend">
        <span class="chip chip-todo">TODO</span>
        <span class="chip chip-inprogress">IN_PROGRESS</span>
        <span class="chip chip-pending">PENDING</span>
        <span class="chip chip-done">DONE</span>
      </footer>

      {popupTask && (
        <TaskPopup key={popupTask.id} task={popupTask} projects={projects}
          onUpdate={handlePopupUpdate}
          onDelete={handlePopupDelete}
          onClose={() => setPopupTask(null)} />
      )}
    </div>
  );
}
