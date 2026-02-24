(() => {
  async function request(path, options = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_e) {
      data = {};
    }
    if (!res.ok) {
      const err = new Error(data.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  window.TaskApi = {
    getTasks() {
      return request("/api/tasks", { method: "GET" });
    },
    createTask(payload) {
      return request("/api/tasks", { method: "POST", body: JSON.stringify(payload || {}) });
    },
    updateTask(taskId, expectedUpdatedAt, changes) {
      return request(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: JSON.stringify({ expected_updated_at: expectedUpdatedAt, changes: changes || {} }),
      });
    },
    deleteTask(taskId, expectedUpdatedAt) {
      return request(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "DELETE",
        body: JSON.stringify({ expected_updated_at: expectedUpdatedAt }),
      });
    },
    linkDependency(op, fromId, toId, expectedUpdatedAt) {
      return request("/api/links/dependency", {
        method: "POST",
        body: JSON.stringify({ op, from_id: fromId, to_id: toId, expected_updated_at: expectedUpdatedAt }),
      });
    },
    linkProject(op, projectId, taskId, expectedUpdatedAt) {
      return request("/api/links/project", {
        method: "POST",
        body: JSON.stringify({ op, project_id: projectId, task_id: taskId, expected_updated_at: expectedUpdatedAt }),
      });
    },
    archiveDone() {
      return request("/api/archive", { method: "POST", body: JSON.stringify({}) });
    },
    regenerateViews() {
      return request("/api/view/regenerate", { method: "POST", body: JSON.stringify({}) });
    },
  };
})();
