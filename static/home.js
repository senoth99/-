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
  window.location.assign("/login");
}

function init() {
  const isAuthed = document.body?.dataset?.authed === "true";
  togglePanels(isAuthed);
  const loginBtn = qs("login-submit");
  const logoutBtn = qs("logout-btn");
  const profileTrigger = qs("profile-trigger");
  const profileDropdown = qs("profile-dropdown");
  loginBtn?.addEventListener("click", handleLogin);
  logoutBtn?.addEventListener("click", handleLogout);

  if (profileTrigger && profileDropdown) {
    profileTrigger.addEventListener("click", (event) => {
      event.stopPropagation();
      profileDropdown.classList.toggle("hidden");
    });

    document.addEventListener("click", (event) => {
      if (
        profileDropdown.classList.contains("hidden") ||
        profileTrigger.contains(event.target) ||
        profileDropdown.contains(event.target)
      ) {
        return;
      }
      profileDropdown.classList.add("hidden");
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        profileDropdown.classList.add("hidden");
      }
    });
  }
}

init();
