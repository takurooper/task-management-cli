(() => {
  const viewRoot = document.getElementById("viewRoot");
  const openLink = document.getElementById("openCurrent");
  const metaNode = document.getElementById("shellMeta");
  const buttons = [...document.querySelectorAll("button[data-view]")];
  if (!viewRoot || buttons.length === 0) return;

  const KEY = "task_view_selected";
  const allowed = new Set(["list", "kanban", "process"]);
  const initial = localStorage.getItem(KEY);
  let current = allowed.has(initial) ? initial : "list";
  let viewsData = null;
  let activeInstance = null;
  let dataStale = false;

  const viewModules = {
    list: window.ListView,
    kanban: window.KanbanView,
    process: window.ProcessView,
  };

  function setMeta(text) {
    if (metaNode) metaNode.textContent = text || "";
  }

  function updateButtons(view) {
    buttons.forEach((btn) => {
      if (btn.dataset.view === view) btn.classList.add("active");
      else btn.classList.remove("active");
    });
    if (openLink) openLink.href = `./${view}.html`;
  }

  function destroyCurrentView() {
    if (activeInstance) {
      activeInstance.destroy();
      activeInstance = null;
    }
  }

  function initView(viewName) {
    // Save state from current view before destroying
    let savedQuery, savedStatuses;
    if (activeInstance) {
      if (typeof activeInstance.getQuery === "function") savedQuery = activeInstance.getQuery();
      if (typeof activeInstance.getStatuses === "function") savedStatuses = activeInstance.getStatuses();
    }
    destroyCurrentView();
    if (!viewsData || !viewModules[viewName]) return;

    const data = viewsData[viewName];
    const cbs = {
      onDataChanged() { dataStale = true; },
    };
    if (savedQuery) cbs.initialQuery = savedQuery;
    if (savedStatuses) cbs.initialStatuses = savedStatuses;

    activeInstance = viewModules[viewName].init(viewRoot, data, cbs);
    const meta = data.meta;
    if (meta) {
      const parts = [];
      if (meta.task_count != null) parts.push(`Tasks ${meta.task_count}`);
      if (meta.node_count != null) parts.push(`Nodes ${meta.node_count}`);
      if (meta.edge_count != null) parts.push(`Edges ${meta.edge_count}`);
      if (meta.generated_at) parts.push(`Generated ${meta.generated_at}`);
      setMeta(parts.join(" / "));
    }
  }

  async function loadData() {
    try {
      viewsData = await window.TaskApi.getViewsData();
      dataStale = false;
    } catch (err) {
      setMeta(`Failed to load data: ${err?.message || "unknown"}`);
    }
  }

  async function switchView(viewName) {
    if (!allowed.has(viewName)) return;
    current = viewName;
    localStorage.setItem(KEY, viewName);
    updateButtons(viewName);

    if (dataStale || !viewsData) {
      setMeta("Loading...");
      await loadData();
    }
    initView(viewName);
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      if (!view || !allowed.has(view)) return;
      switchView(view);
    });
  });

  // Initial load
  updateButtons(current);
  setMeta("Loading...");
  loadData().then(() => initView(current));
})();
