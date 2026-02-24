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

export function getViewsData() {
  return request("/api/views/data", { method: "GET" });
}

export function getTasks() {
  return request("/api/tasks", { method: "GET" });
}

export function createTask(payload) {
  return request("/api/tasks", { method: "POST", body: JSON.stringify(payload || {}) });
}

export function updateTask(taskId, expectedUpdatedAt, changes) {
  return request(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: JSON.stringify({ expected_updated_at: expectedUpdatedAt, changes: changes || {} }),
  });
}

export function deleteTask(taskId, expectedUpdatedAt) {
  return request(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
    body: JSON.stringify({ expected_updated_at: expectedUpdatedAt }),
  });
}

export function linkDependency(op, fromId, toId, expectedUpdatedAt) {
  return request("/api/links/dependency", {
    method: "POST",
    body: JSON.stringify({ op, from_id: fromId, to_id: toId, expected_updated_at: expectedUpdatedAt }),
  });
}

export function linkProject(op, projectId, taskId, expectedUpdatedAt) {
  return request("/api/links/project", {
    method: "POST",
    body: JSON.stringify({ op, project_id: projectId, task_id: taskId, expected_updated_at: expectedUpdatedAt }),
  });
}

export function archiveDone() {
  return request("/api/archive", { method: "POST", body: JSON.stringify({}) });
}

export function regenerateViews() {
  return request("/api/view/regenerate", { method: "POST", body: JSON.stringify({}) });
}
