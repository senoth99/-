const qs = (id) => document.getElementById(id);

const TASKS_KEY = "crm.tasks";
const KNOWLEDGE_KEY = "crm.knowledge";

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

const defaultTasks = [
  {
    id: "t1",
    status: "В работе",
    priority: "Высокий",
    title: "Автоматизация заказов",
    assignee: "Админ",
    deadline: "2024-02-23",
  },
  {
    id: "t2",
    status: "План",
    priority: "Средний",
    title: "Наладить работу по поставкам",
    assignee: "Админ",
    deadline: "2024-02-28",
  },
];

const defaultKnowledge = [
  {
    id: "k1",
    section: "CRM",
    title: "Как заполнять задачи",
    owner: "Админ",
    tag: "WIKI",
  },
  {
    id: "k2",
    section: "SMM",
    title: "Регламент публикаций",
    owner: "Админ",
    tag: "Регламент",
  },
];

function getStored(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function setStored(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Ошибка запроса");
  }
  return response.json();
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
      <td>${task.assignee}</td>
      <td>${deadlineLabel}</td>
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
      <td><span class="tag tag-section">${item.section}</span></td>
      <td>${item.title}</td>
      <td>${item.owner}</td>
      <td><span class="tag tag-wiki">${item.tag}</span></td>
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

function init() {
  const tasks = getStored(TASKS_KEY, defaultTasks);
  const knowledge = getStored(KNOWLEDGE_KEY, defaultKnowledge);
  setStored(TASKS_KEY, tasks);
  setStored(KNOWLEDGE_KEY, knowledge);

  renderTasks(tasks);
  renderKnowledge(knowledge);
  renderStats(tasks);
  setDefaultDeadline();

  loadAssignees();

  qs("task-add")?.addEventListener("click", () => {
    const title = qs("task-title")?.value.trim();
    const status = qs("task-status")?.value;
    const priority = qs("task-priority")?.value;
    const assignee = qs("task-assignee")?.value;
    const deadline = qs("task-deadline")?.value;
    if (!title) return;
    const next = [
      {
        id: createId("task"),
        title,
        status,
        priority,
        assignee,
        deadline,
      },
      ...getStored(TASKS_KEY, []),
    ];
    setStored(TASKS_KEY, next);
    qs("task-title").value = "";
    qs("task-deadline").value = "";
    setDefaultDeadline();
    renderTasks(next);
    renderStats(next);
  });

  qs("knowledge-add")?.addEventListener("click", () => {
    const title = qs("knowledge-title")?.value.trim();
    const section = qs("knowledge-section")?.value.trim() || "Общее";
    const owner = qs("knowledge-owner")?.value;
    const tag = qs("knowledge-tag")?.value.trim() || "WIKI";
    if (!title) return;
    const next = [
      {
        id: createId("knowledge"),
        title,
        section,
        owner,
        tag,
      },
      ...getStored(KNOWLEDGE_KEY, []),
    ];
    setStored(KNOWLEDGE_KEY, next);
    qs("knowledge-title").value = "";
    qs("knowledge-section").value = "";
    qs("knowledge-tag").value = "";
    renderKnowledge(next);
  });

  qs("task-table-body")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-task-delete]");
    if (!btn) return;
    const id = btn.dataset.taskDelete;
    const next = getStored(TASKS_KEY, []).filter((task) => task.id !== id);
    setStored(TASKS_KEY, next);
    renderTasks(next);
    renderStats(next);
  });

  qs("knowledge-table-body")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-knowledge-delete]");
    if (!btn) return;
    const id = btn.dataset.knowledgeDelete;
    const next = getStored(KNOWLEDGE_KEY, []).filter((item) => item.id !== id);
    setStored(KNOWLEDGE_KEY, next);
    renderKnowledge(next);
  });
}

init();
