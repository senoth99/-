const qs = (id) => document.getElementById(id);

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

const accessPages = (() => {
  try {
    return JSON.parse(document.body?.dataset?.accessPages || "[]");
  } catch (err) {
    return [];
  }
})();

function setError(message = "") {
  const error = qs("employee-error");
  if (error) {
    error.textContent = message;
  }
}

function formatDate(value) {
  if (!value) return "—";
  return value.split("T")[0];
}

function renderAccessToggles(employee) {
  const access = employee.access || {};
  return accessPages
    .map((page) => {
      const checked = access[page.key] !== false;
      return `
        <label class="access-toggle">
          <input
            type="checkbox"
            data-access-key="${page.key}"
            ${checked ? "checked" : ""}
          />
          <span>${page.label}</span>
        </label>
      `;
    })
    .join("");
}

function renderEmployees(employees) {
  const list = qs("employee-list");
  if (!list) return;
  list.innerHTML = "";
  if (!employees.length) {
    list.innerHTML = "<p class='subtitle'>Нет созданных профилей.</p>";
    return;
  }
  employees.forEach((employee) => {
    const card = document.createElement("div");
    card.className = "employee-card";
    card.dataset.employeeId = employee.id;
    card.innerHTML = `
      <div class="employee-head">
        <div>
          <h3>${employee.name}</h3>
          <p class="subtitle">Создан: ${formatDate(employee.created_at)}</p>
        </div>
        <div class="employee-actions">
          <button class="ghost small" data-employee-reset="${employee.id}">
            Сменить пароль
          </button>
          <button class="ghost small danger" data-employee-delete="${employee.id}">
            Удалить
          </button>
        </div>
      </div>
      <div class="employee-access">
        <span class="access-title">Доступы</span>
        <div class="access-grid">
          ${renderAccessToggles(employee)}
        </div>
      </div>
    `;
    list.appendChild(card);
  });
}

async function loadEmployees() {
  const employees = await api("/api/employees");
  renderEmployees(employees);
}

async function updateAccess(employeeId, pageKey, allowed) {
  await api(`/api/employees/${employeeId}/access`, {
    method: "POST",
    body: JSON.stringify({ page: pageKey, allowed }),
  });
}

function init() {
  loadEmployees().catch((err) => setError(err.message));

  qs("employee-add")?.addEventListener("click", async () => {
    const name = qs("employee-name")?.value.trim();
    const password = qs("employee-password")?.value.trim();
    setError();
    if (!name || !password) {
      setError("Заполните имя и пароль.");
      return;
    }
    try {
      await api("/api/employees", {
        method: "POST",
        body: JSON.stringify({ name, password }),
      });
      qs("employee-name").value = "";
      qs("employee-password").value = "";
      await loadEmployees();
    } catch (err) {
      setError(err.message);
    }
  });

  qs("employee-list")?.addEventListener("click", async (event) => {
    const deleteBtn = event.target.closest("[data-employee-delete]");
    const resetBtn = event.target.closest("[data-employee-reset]");
    setError();
    try {
      if (deleteBtn) {
        await api(`/api/employees/${deleteBtn.dataset.employeeDelete}`, {
          method: "DELETE",
        });
        await loadEmployees();
        return;
      }
      if (resetBtn) {
        const password = prompt("Введите новый пароль");
        if (!password) return;
        await api(`/api/employees/${resetBtn.dataset.employeeReset}/password`, {
          method: "POST",
          body: JSON.stringify({ password }),
        });
        await loadEmployees();
      }
    } catch (err) {
      setError(err.message);
    }
  });

  qs("employee-list")?.addEventListener("change", async (event) => {
    const checkbox = event.target.closest("input[data-access-key]");
    if (!checkbox) return;
    const card = checkbox.closest(".employee-card");
    if (!card) return;
    const employeeId = card.dataset.employeeId;
    const pageKey = checkbox.dataset.accessKey;
    const allowed = checkbox.checked;
    setError();
    try {
      await updateAccess(employeeId, pageKey, allowed);
    } catch (err) {
      checkbox.checked = !allowed;
      setError(err.message);
    }
  });
}

init();
