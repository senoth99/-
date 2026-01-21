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

function togglePanels(isAuthed) {
  const authPanel = qs("auth-panel");
  const menuPanel = qs("menu-panel");
  const logoutBtn = qs("logout-btn");
  if (authPanel) {
    authPanel.classList.toggle("hidden", isAuthed);
  }
  if (menuPanel) {
    menuPanel.classList.toggle("hidden", !isAuthed);
  }
  if (logoutBtn) {
    logoutBtn.classList.toggle("hidden", !isAuthed);
  }
}

async function handleLogin() {
  const password = qs("login-password")?.value.trim();
  const error = qs("login-error");
  if (error) {
    error.textContent = "";
  }
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    togglePanels(true);
  } catch (err) {
    if (error) {
      error.textContent = err.message;
    }
  }
}

async function handleLogout() {
  await api("/api/logout", { method: "POST" });
  togglePanels(false);
}

function init() {
  const isAuthed = document.body?.dataset?.authed === "true";
  togglePanels(isAuthed);
  const loginBtn = qs("login-submit");
  const logoutBtn = qs("logout-btn");
  loginBtn?.addEventListener("click", handleLogin);
  logoutBtn?.addEventListener("click", handleLogout);
}

init();
