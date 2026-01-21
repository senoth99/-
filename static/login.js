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

const steps = ["role", "profile", "password"];
let currentStep = "role";
let selectedRole = "admin";
let selectedEmployeeId = null;

function setError(message = "") {
  const error = qs("login-error");
  if (error) {
    error.textContent = message;
  }
}

function setStep(step) {
  currentStep = step;
  document.querySelectorAll(".login-step").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.step !== step);
  });
  document.querySelectorAll(".login-stepper-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.stepper === step);
  });
}

function getRole() {
  return (
    document.querySelector(".role-option.selected")?.dataset?.role || "employee"
  );
}

async function fetchProfiles() {
  const container = qs("employee-profiles");
  if (!container) return;
  container.innerHTML = "";
  try {
    const profiles = await api("/api/employees?public=true");
    if (!profiles.length) {
      container.innerHTML = "<p class='subtitle'>Пока нет профилей сотрудников.</p>";
      return;
    }
    profiles.forEach((profile) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "profile-card";
      button.dataset.employeeId = profile.id;
      button.textContent = profile.name;
      container.appendChild(button);
    });
  } catch (err) {
    container.innerHTML = "<p class='subtitle'>Не удалось загрузить профили.</p>";
  }
}

async function handleLogin() {
  const password = qs("login-password")?.value.trim();
  setError();
  try {
    const payload = {
      password,
      role: selectedRole,
    };
    if (selectedRole === "employee") {
      payload.employee_id = selectedEmployeeId;
    }
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    window.location.assign("/");
  } catch (err) {
    setError(err.message);
  }
}

function init() {
  const loginBtn = qs("login-submit");
  const rolePicker = qs("role-picker");
  const roleNext = qs("role-next");
  const profileBack = qs("profile-back");
  const profileNext = qs("profile-next");
  const passwordBack = qs("password-back");
  const profilesGrid = qs("employee-profiles");

  rolePicker?.addEventListener("click", (event) => {
    const target = event.target;
    const option = target.closest(".role-option");
    if (!option) return;
    document.querySelectorAll(".role-option").forEach((button) => {
      button.classList.toggle("selected", button === option);
    });
    selectedRole = getRole();
  });

  roleNext?.addEventListener("click", async () => {
    setError();
    selectedRole = getRole();
    if (selectedRole === "employee") {
      selectedEmployeeId = null;
      await fetchProfiles();
      setStep("profile");
      return;
    }
    setStep("password");
  });

  profilesGrid?.addEventListener("click", (event) => {
    const card = event.target.closest(".profile-card");
    if (!card) return;
    selectedEmployeeId = card.dataset.employeeId;
    document.querySelectorAll(".profile-card").forEach((button) => {
      button.classList.toggle("selected", button === card);
    });
  });

  profileBack?.addEventListener("click", () => {
    setStep("role");
  });

  profileNext?.addEventListener("click", () => {
    setError();
    if (!selectedEmployeeId) {
      setError("Выберите профиль сотрудника.");
      return;
    }
    setStep("password");
  });

  passwordBack?.addEventListener("click", () => {
    if (selectedRole === "employee") {
      setStep("profile");
      return;
    }
    setStep("role");
  });

  loginBtn?.addEventListener("click", handleLogin);
  setStep(currentStep);
}

init();
