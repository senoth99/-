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
  const error = qs("login-error");
  if (error) {
    error.textContent = message;
  }
}

function init() {
  const form = qs("login-form");
  const loginInput = qs("login-name");
  const passwordInput = qs("login-password");
  if (!form || !loginInput || !passwordInput) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError();
    const login = loginInput.value.trim();
    const password = passwordInput.value.trim();
    if (!login || !password) {
      setError("Введите логин и пароль.");
      return;
    }
    try {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ login, password }),
      });
      window.location.assign("/");
    } catch (err) {
      setError(err.message);
    }
  });
}

init();
