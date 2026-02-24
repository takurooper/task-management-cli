import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import * as api from "./api/client";
import { ListView } from "./components/ListView";
import { KanbanView } from "./components/KanbanView";
import { ProcessView } from "./components/ProcessView";

const VIEWS = ["list", "kanban", "process"];
const VIEW_KEY = "task_view_selected";

function metaText(meta) {
  if (!meta) return "";
  const parts = [];
  if (meta.task_count != null) parts.push(`Tasks ${meta.task_count}`);
  if (meta.node_count != null) parts.push(`Nodes ${meta.node_count}`);
  if (meta.edge_count != null) parts.push(`Edges ${meta.edge_count}`);
  if (meta.generated_at) parts.push(`Generated ${meta.generated_at}`);
  return parts.join(" / ");
}

export function App() {
  const [currentView, setCurrentView] = useState(() => {
    const saved = localStorage.getItem(VIEW_KEY);
    return VIEWS.includes(saved) ? saved : "list";
  });
  const [viewsData, setViewsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const dataStaleRef = useRef(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getViewsData();
      setViewsData(data);
      dataStaleRef.current = false;
    } catch (err) {
      setError(err?.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const switchView = useCallback(async (view) => {
    if (!VIEWS.includes(view)) return;
    setCurrentView(view);
    localStorage.setItem(VIEW_KEY, view);
    if (dataStaleRef.current) {
      await loadData();
    }
  }, [loadData]);

  const handleDataChanged = useCallback(() => {
    dataStaleRef.current = true;
  }, []);

  const handleRefresh = useCallback(() => { loadData(); }, [loadData]);

  const data = viewsData?.[currentView];
  const projects = viewsData?.list?.projects || viewsData?.kanban?.projects || viewsData?.process?.projects || [];
  const meta = data?.meta;

  return (
    <main class="shell app-shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Task Management CLI</p>
          <h1 class="title">View Switcher</h1>
        </div>
        <div class="meta">
          {loading ? "Loading..." : error ? `Error: ${error}` : metaText(meta)}
        </div>
      </header>

      <section class="controls switcher-controls" aria-label="View switcher">
        {VIEWS.map((v) => (
          <button key={v} type="button" class={v === currentView ? "active" : ""}
            onClick={() => switchView(v)}>
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
        <button type="button" class="refresh-btn" onClick={handleRefresh} title="Refresh data">↻</button>
      </section>

      <section class="view-root">
        {loading && <div class="loading-msg">Loading data...</div>}
        {error && <div class="error-msg">{error}</div>}
        {!loading && !error && data && currentView === "list" && (
          <ListView data={data} projects={projects} onDataChanged={handleDataChanged} />
        )}
        {!loading && !error && data && currentView === "kanban" && (
          <KanbanView data={data} projects={projects} onDataChanged={handleDataChanged} />
        )}
        {!loading && !error && data && currentView === "process" && (
          <ProcessView data={data} projects={projects} onDataChanged={handleDataChanged} />
        )}
      </section>
    </main>
  );
}
