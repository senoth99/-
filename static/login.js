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

const state = {
  step: 1,
  role: null,
  profileId: null,
  password: "",
};

function setError(message = "") {
  const error = qs("login-error");
  if (error) {
    error.textContent = message;
  }
}

function updateStepper(step) {
  const stepKey = step === 1 ? "role" : step === 2 ? "profile" : "password";
  document.querySelectorAll(".login-stepper-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.stepper === stepKey);
  });
}

function setStep(step) {
  state.step = step;
  updateStepper(step);
  renderStep();
}

function goToStep1() {
  setError();
  setStep(1);
}

async function goToStep2() {
  setError();
  if (!state.role) {
    setError("Выберите роль для входа.");
    return;
  }
  state.profileId = null;
  await fetchProfiles();
  setStep(2);
}

function goToStep3() {
  setError();
  if (!state.profileId) {
    setError("Выберите профиль сотрудника.");
    return;
  }
  setStep(3);
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
      if (state.profileId === profile.id) {
        button.classList.add("selected");
      }
      container.appendChild(button);
    });
  } catch (err) {
    container.innerHTML = "<p class='subtitle'>Не удалось загрузить профили.</p>";
  }
}

async function login(role, profileId, password) {
  try {
    const payload = {
      password,
      role,
      employee_id: profileId,
    };
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    window.location.assign("/");
  } catch (err) {
    setError(err.message);
  }
}

function createRoleStep() {
  const section = document.createElement("section");
  section.className = "login-step";

  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = "Выберите роль для входа в систему.";

  const picker = document.createElement("div");
  picker.className = "role-picker";

  const adminButton = document.createElement("button");
  adminButton.type = "button";
  adminButton.className = "role-option";
  adminButton.dataset.role = "admin";
  adminButton.textContent = "Админ";

  const employeeButton = document.createElement("button");
  employeeButton.type = "button";
  employeeButton.className = "role-option";
  employeeButton.dataset.role = "employee";
  employeeButton.textContent = "Сотрудник";

  [adminButton, employeeButton].forEach((button) => {
    if (state.role === button.dataset.role) {
      button.classList.add("selected");
    }
    button.addEventListener("click", () => {
      state.role = button.dataset.role;
      [adminButton, employeeButton].forEach((item) => {
        item.classList.toggle("selected", item === button);
      });
      nextButton.disabled = !state.role;
    });
  });

  picker.appendChild(adminButton);
  picker.appendChild(employeeButton);

  const actions = document.createElement("div");
  actions.className = "step-actions step-actions--stack";

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "primary button-wide";
  nextButton.textContent = "Продолжить";
  nextButton.disabled = !state.role;
  nextButton.addEventListener("click", () => {
    void goToStep2();
  });

  actions.appendChild(nextButton);
  section.appendChild(subtitle);
  section.appendChild(picker);
  section.appendChild(actions);

  return section;
}

function createProfileStep() {
  const section = document.createElement("section");
  section.className = "login-step";

  const picker = document.createElement("div");
  picker.className = "profile-picker";

  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = "Выберите профиль сотрудника для входа.";

  const grid = document.createElement("div");
  grid.className = "profile-grid";
  grid.id = "employee-profiles";

  grid.addEventListener("click", (event) => {
    const card = event.target.closest(".profile-card");
    if (!card) return;
    state.profileId = card.dataset.employeeId;
    grid.querySelectorAll(".profile-card").forEach((button) => {
      button.classList.toggle("selected", button === card);
    });
    nextButton.disabled = !state.profileId;
  });

  picker.appendChild(subtitle);
  picker.appendChild(grid);

  const actions = document.createElement("div");
  actions.className = "step-actions step-actions--stack";

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "secondary button-wide";
  backButton.textContent = "Назад";
  backButton.addEventListener("click", goToStep1);

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "primary button-wide";
  nextButton.textContent = "Далее";
  nextButton.disabled = !state.profileId;
  nextButton.addEventListener("click", goToStep3);

  actions.appendChild(backButton);
  actions.appendChild(nextButton);

  section.appendChild(picker);
  section.appendChild(actions);

  void fetchProfiles();

  return section;
}

function createPasswordStep() {
  const section = document.createElement("section");
  section.className = "login-step";

  const wrapper = document.createElement("div");

  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = "Введите пароль доступа.";

  const label = document.createElement("label");
  label.textContent = "Пароль";

  const input = document.createElement("input");
  input.type = "password";
  input.placeholder = "Введите пароль";
  input.value = state.password;

  input.addEventListener("input", (event) => {
    state.password = event.target.value.trim();
    submitButton.disabled = !state.password;
  });

  label.appendChild(input);
  wrapper.appendChild(subtitle);
  wrapper.appendChild(label);

  const actions = document.createElement("div");
  actions.className = "step-actions step-actions--stack";

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "secondary button-wide";
  backButton.textContent = "Назад";
  backButton.addEventListener("click", () => {
    setError();
    setStep(2);
  });

  const submitButton = document.createElement("button");
  submitButton.type = "button";
  submitButton.className = "primary button-wide";
  submitButton.textContent = "Войти";
  submitButton.disabled = !state.password;
  submitButton.addEventListener("click", () => {
    setError();
    if (!state.password) {
      setError("Введите пароль.");
      return;
    }
    if (!state.role || !state.profileId) {
      setError("Вернитесь и заполните предыдущие шаги.");
      return;
    }
    void login(state.role, state.profileId, state.password);
  });

  actions.appendChild(backButton);
  actions.appendChild(submitButton);

  section.appendChild(wrapper);
  section.appendChild(actions);

  return section;
}

function renderStep() {
  const container = qs("login-steps");
  if (!container) return;
  container.innerHTML = "";

  let stepNode = null;

  if (state.step === 1) {
    stepNode = createRoleStep();
  } else if (state.step === 2) {
    stepNode = createProfileStep();
  } else if (state.step === 3) {
    stepNode = createPasswordStep();
  }

  if (stepNode) {
    container.appendChild(stepNode);
  }
}

function init() {
  updateStepper(state.step);
  renderStep();
}

init();
