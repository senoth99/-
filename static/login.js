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

async function handleLogin() {
  const password = qs("login-password")?.value.trim();
  const role =
    document.querySelector(".role-option.selected")?.dataset?.role || "employee";
  const error = qs("login-error");
  if (error) {
    error.textContent = "";
  }
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password, role }),
    });
    window.location.assign("/");
  } catch (err) {
    if (error) {
      error.textContent = err.message;
    }
  }
}

function init() {
  const loginBtn = qs("login-submit");
  const rolePicker = qs("role-picker");
  rolePicker?.addEventListener("click", (event) => {
    const target = event.target;
    const option = target.closest(".role-option");
    if (!option) return;
    document.querySelectorAll(".role-option").forEach((button) => {
      button.classList.toggle("selected", button === option);
    });
  });
  loginBtn?.addEventListener("click", handleLogin);
}

init();
