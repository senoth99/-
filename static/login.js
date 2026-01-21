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
  const error = qs("login-error");
  if (error) {
    error.textContent = "";
  }
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password }),
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
  loginBtn?.addEventListener("click", handleLogin);
}

init();
