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

function setError(message = "") {
  const error = qs("employee-error");
  if (error) {
    error.textContent = message;
  }
}

function renderEmployees(employees) {
  const body = qs("employee-table-body");
  if (!body) return;
  body.innerHTML = "";
  employees.forEach((employee) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${employee.name}</td>
      <td>${employee.created_at?.split("T")[0] || "—"}</td>
      <td>
        <button class="ghost small" data-employee-reset="${employee.id}">
          Сменить пароль
        </button>
      </td>
      <td>
        <button class="ghost small danger" data-employee-delete="${employee.id}">
          Удалить
        </button>
      </td>
    `;
    body.appendChild(row);
  });
}

async function loadEmployees() {
  const employees = await api("/api/employees");
  renderEmployees(employees);
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

  qs("employee-table-body")?.addEventListener("click", async (event) => {
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
}

init();
