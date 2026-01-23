const qs = (id) => document.getElementById(id);

const getTodayValue = () => new Date().toISOString().split("T")[0];

const formatDateLabel = (value) => {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString("ru-RU");
};

const setDefaultDeadline = () => {
  const deadline = qs("task-deadline");
  if (!deadline) return;
  if (!deadline.value) {
    deadline.value = getTodayValue();
  }
  deadline.setAttribute("lang", "ru");
  if (!deadline.getAttribute("placeholder")) {
    deadline.setAttribute("placeholder", "дд.мм.гг");
  }
};

const POLL_INTERVAL_MS = 15000;
let pollHandle = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Ошибка запроса");
  }
  return response.json();
}

function setSyncStatus(id, message, status = "idle") {
  const el = qs(id);
  if (!el) return;
  el.textContent = message;
  el.dataset.status = status;
}

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU");
}

async function loadAssignees() {
  const selects = [qs("task-assignee"), qs("knowledge-owner")].filter(Boolean);
  if (!selects.length) return [];
  let employees = [];
  try {
    employees = await api("/api/employees?public=true");
  } catch (err) {
    employees = [];
  }
  const options = ["Админ", ...employees.map((item) => item.name)];
  selects.forEach((select) => {
    select.innerHTML = "";
    options.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
  });
  return options;
}

function renderTasks(tasks) {
  const body = qs("task-table-body");
  if (!body) return;
  body.innerHTML = "";
  tasks.forEach((task) => {
    const deadlineLabel = formatDateLabel(task.deadline);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="tag tag-status">${task.status}</span></td>
      <td><span class="tag tag-priority">${task.priority}</span></td>
      <td>${task.title}</td>
      <td>${task.assignee || "—"}</td>
      <td>${deadlineLabel}</td>
      <td>${task.created_by_name || "—"}</td>
      <td><button class="ghost small" data-task-delete="${task.id}">Удалить</button></td>
    `;
    body.appendChild(row);
  });
}

function renderKnowledge(items) {
  const body = qs("knowledge-table-body");
  if (!body) return;
  body.innerHTML = "";
  items.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="tag tag-section">${item.section || "Общее"}</span></td>
      <td>${item.title}</td>
      <td>${item.owner || "—"}</td>
      <td><span class="tag tag-wiki">${item.tag || "WIKI"}</span></td>
      <td>${item.created_by_name || "—"}</td>
      <td><button class="ghost small" data-knowledge-delete="${item.id}">Удалить</button></td>
    `;
    body.appendChild(row);
  });
}

function renderStats(tasks) {
  const container = qs("load-stats");
  if (!container) return;
  const counts = tasks.reduce((acc, task) => {
    const key = task.assignee || "Без ответственного";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const entries = Object.entries(counts);
  if (!entries.length) {
    container.innerHTML = "<p class='subtitle'>Нет данных по задачам.</p>";
    return;
  }
  const max = Math.max(...entries.map(([, count]) => count));
  container.innerHTML = "";
  entries.forEach(([name, count]) => {
    const row = document.createElement("div");
    row.className = "stat-row";
    row.innerHTML = `
      <div class="stat-name">${name}</div>
      <div class="stat-bar">
        <span style="width: ${(count / max) * 100}%"></span>
      </div>
      <div class="stat-count">${count}</div>
    `;
    container.appendChild(row);
  });
}

async function refreshTasks({ silent = false } = {}) {
  try {
    if (!silent) {
      setSyncStatus("task-sync-status", "Синхронизация...", "syncing");
    }
    const tasks = await api("/api/tasks");
    renderTasks(tasks);
    renderStats(tasks);
    setSyncStatus(
      "task-sync-status",
      `Обновлено ${formatTimestamp(new Date().toISOString())}`,
      "ready",
    );
    return tasks;
  } catch (err) {
    setSyncStatus("task-sync-status", "Ошибка синхронизации", "error");
    return [];
  }
}

async function refreshKnowledge({ silent = false } = {}) {
  try {
    if (!silent) {
      setSyncStatus("knowledge-sync-status", "Синхронизация...", "syncing");
    }
    const items = await api("/api/knowledge");
    renderKnowledge(items);
    setSyncStatus(
      "knowledge-sync-status",
      `Обновлено ${formatTimestamp(new Date().toISOString())}`,
      "ready",
    );
    return items;
  } catch (err) {
    setSyncStatus("knowledge-sync-status", "Ошибка синхронизации", "error");
    return [];
  }
}

function startPolling() {
  if (pollHandle) return;
  pollHandle = setInterval(() => {
    if (qs("task-table-body")) {
      refreshTasks({ silent: true });
    }
    if (qs("knowledge-table-body")) {
      refreshKnowledge({ silent: true });
    }
    if (!qs("task-table-body") && qs("load-stats")) {
      refreshTasks({ silent: true });
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (!pollHandle) return;
  clearInterval(pollHandle);
  pollHandle = null;
}

function initTasksPage() {
  setDefaultDeadline();
  refreshTasks();

  qs("task-add")?.addEventListener("click", async () => {
    const title = qs("task-title")?.value.trim();
    const status = qs("task-status")?.value;
    const priority = qs("task-priority")?.value;
    const assignee = qs("task-assignee")?.value;
    const deadline = qs("task-deadline")?.value;
    if (!title) return;
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title,
        status,
        priority,
        assignee,
        deadline,
      }),
    });
    qs("task-title").value = "";
    qs("task-deadline").value = "";
    setDefaultDeadline();
    refreshTasks();
  });

  qs("task-table-body")?.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-task-delete]");
    if (!btn) return;
    const id = btn.dataset.taskDelete;
    await api(`/api/tasks/${id}`, { method: "DELETE" });
    refreshTasks();
  });
}

function initKnowledgePage() {
  refreshKnowledge();

  qs("knowledge-add")?.addEventListener("click", async () => {
    const title = qs("knowledge-title")?.value.trim();
    const section = qs("knowledge-section")?.value.trim() || "Общее";
    const owner = qs("knowledge-owner")?.value;
    const tag = qs("knowledge-tag")?.value.trim() || "WIKI";
    if (!title) return;
    await api("/api/knowledge", {
      method: "POST",
      body: JSON.stringify({
        title,
        section,
        owner,
        tag,
      }),
    });
    qs("knowledge-title").value = "";
    qs("knowledge-section").value = "";
    qs("knowledge-tag").value = "";
    refreshKnowledge();
  });

  qs("knowledge-table-body")?.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-knowledge-delete]");
    if (!btn) return;
    const id = btn.dataset.knowledgeDelete;
    await api(`/api/knowledge/${id}`, { method: "DELETE" });
    refreshKnowledge();
  });
}

function initOperationsHome() {
  if (!qs("load-stats")) return;
  refreshTasks();
}

function init() {
  loadAssignees();

  if (qs("task-table-body")) {
    initTasksPage();
  }

  if (qs("knowledge-table-body")) {
    initKnowledgePage();
  }

  initOperationsHome();

  if (qs("task-table-body") || qs("knowledge-table-body") || qs("load-stats")) {
    startPolling();
    window.addEventListener("beforeunload", stopPolling);
  }
}

init();
