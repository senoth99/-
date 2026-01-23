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
  employees: [],
  courses: [],
};

function setError(message = "") {
  const el = qs("course-error");
  if (el) {
    el.textContent = message;
  }
}

function createLessonInput(value = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "lms-inline-item";
  wrapper.innerHTML = `
    <input type="text" value="${value}" placeholder="Название" />
    <button class="ghost small" type="button">Удалить</button>
  `;
  wrapper.querySelector("button").addEventListener("click", () => {
    wrapper.remove();
  });
  return wrapper;
}

function createTopicBlock(topic = { title: "", lessons: [], tests: [] }) {
  const wrapper = document.createElement("div");
  wrapper.className = "lms-topic";
  wrapper.innerHTML = `
    <div class="lms-topic-header">
      <input type="text" class="lms-topic-title" placeholder="Название темы" value="${topic.title || ""}" />
      <button class="ghost small" type="button" data-remove-topic>Удалить тему</button>
    </div>
    <div class="lms-topic-body">
      <div>
        <div class="lms-topic-label">Уроки</div>
        <div class="lms-topic-list" data-lessons></div>
        <button class="secondary small" type="button" data-add-lesson>+ Урок</button>
      </div>
      <div>
        <div class="lms-topic-label">Тесты</div>
        <div class="lms-topic-list" data-tests></div>
        <button class="secondary small" type="button" data-add-test>+ Тест</button>
      </div>
    </div>
  `;
  wrapper
    .querySelector("[data-remove-topic]")
    .addEventListener("click", () => wrapper.remove());

  const lessonsContainer = wrapper.querySelector("[data-lessons]");
  const testsContainer = wrapper.querySelector("[data-tests]");
  (topic.lessons || []).forEach((lesson) => {
    lessonsContainer.appendChild(createLessonInput(lesson));
  });
  (topic.tests || []).forEach((test) => {
    testsContainer.appendChild(createLessonInput(test));
  });
  wrapper
    .querySelector("[data-add-lesson]")
    .addEventListener("click", () => {
      lessonsContainer.appendChild(createLessonInput());
    });
  wrapper.querySelector("[data-add-test]").addEventListener("click", () => {
    testsContainer.appendChild(createLessonInput());
  });
  return wrapper;
}

function collectOutline() {
  return Array.from(document.querySelectorAll(".lms-topic")).map((topic) => {
    const title = topic.querySelector(".lms-topic-title")?.value.trim();
    const lessons = Array.from(topic.querySelectorAll("[data-lessons] input"))
      .map((input) => input.value.trim())
      .filter(Boolean);
    const tests = Array.from(topic.querySelectorAll("[data-tests] input"))
      .map((input) => input.value.trim())
      .filter(Boolean);
    return {
      title,
      lessons,
      tests,
    };
  });
}

function renderEmployees() {
  const container = qs("lms-employee-list");
  if (!container) return;
  container.innerHTML = "";
  if (!state.employees.length) {
    container.innerHTML = "<p class='subtitle'>Нет сотрудников.</p>";
    return;
  }
  state.employees.forEach((employee) => {
    const card = document.createElement("div");
    card.className = "lms-employee-card";
    card.innerHTML = `
      <div class="lms-employee-avatar">
        ${
          employee.avatar_url
            ? `<img src="${employee.avatar_url}" alt="${employee.name}" />`
            : `<span>${employee.name.slice(0, 1).toUpperCase()}</span>`
        }
      </div>
      <div>
        <h4>${employee.name}</h4>
        <p class="subtitle">Логин: ${employee.login}</p>
        <span class="lms-employee-xp">XP: ${employee.xp || 0}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderCourseAdminList() {
  const container = qs("course-admin-list");
  if (!container) return;
  container.innerHTML = "";
  if (!state.courses.length) {
    container.innerHTML = "<p class='subtitle'>Курсы еще не созданы.</p>";
    return;
  }
  state.courses.forEach((course) => {
    const card = document.createElement("div");
    card.className = "lms-admin-course";
    card.dataset.courseId = course.id;
    const accessHtml = state.employees
      .map((employee) => {
        const allowed = course.is_public
          ? true
          : course.access?.[employee.login] === true;
        return `
          <label class="access-toggle">
            <input
              type="checkbox"
              data-course-access
              data-login="${employee.login}"
              ${allowed ? "checked" : ""}
              ${course.is_public ? "disabled" : ""}
            />
            <span>${employee.name}</span>
          </label>
        `;
      })
      .join("");

    const progressHtml = state.employees
      .map((employee) => {
        const progress = course.progress?.[employee.login] || {};
        return `
        <div class="lms-progress-row" data-login="${employee.login}">
          <div>
            <strong>${employee.name}</strong>
            <p class="subtitle">${employee.login}</p>
          </div>
          <select data-progress-status>
            <option value="not_started" ${
              progress.status === "not_started" ? "selected" : ""
            }>Не начат</option>
            <option value="in_progress" ${
              progress.status === "in_progress" ? "selected" : ""
            }>В процессе</option>
            <option value="completed" ${
              progress.status === "completed" ? "selected" : ""
            }>Пройден</option>
          </select>
          <input
            type="text"
            placeholder="Текущая тема"
            data-progress-topic
            value="${progress.current_topic || ""}"
          />
          <input
            type="text"
            placeholder="Текущий урок"
            data-progress-lesson
            value="${progress.current_lesson || ""}"
          />
          <button class="ghost small" data-progress-save>Сохранить</button>
        </div>
        `;
      })
      .join("");

    const summary = course.summary || { topics: 0, lessons: 0, tests: 0 };

    card.innerHTML = `
      <div class="lms-admin-head">
        <div>
          <h3>${course.title}</h3>
          <p class="subtitle">${course.description || "Описание отсутствует."}</p>
        </div>
        <button class="ghost small danger" data-course-delete>Удалить</button>
      </div>
      <div class="lms-admin-meta">
        <span>Категория: ${course.category || "—"}</span>
        <span>Уровень: ${course.level || "—"}</span>
        <span>Длительность: ${course.duration || "—"}</span>
        <span>XP: ${course.xp_value || 0}</span>
        <span>Темы: ${summary.topics}</span>
        <span>Уроки: ${summary.lessons}</span>
        <span>Тесты: ${summary.tests}</span>
        <span class="lms-public-tag">
          ${course.is_public ? "Доступно всем" : "Доступ по списку"}
        </span>
      </div>
      <div class="lms-admin-section">
        <h4>Доступы к курсу</h4>
        <div class="access-grid">${accessHtml}</div>
        ${
          course.is_public
            ? "<p class='subtitle'>Курс открыт для всех. Чтобы выдавать доступы выборочно, создайте курс с закрытым доступом.</p>"
            : ""
        }
      </div>
      <div class="lms-admin-section">
        <h4>Прогресс сотрудников</h4>
        <div class="lms-progress-grid">${progressHtml}</div>
      </div>
    `;
    container.appendChild(card);
  });
}

async function loadAdminData() {
  const data = await api("/api/training/admin-data");
  state.employees = data.employees || [];
  state.courses = data.courses || [];
  renderEmployees();
  renderCourseAdminList();
}

async function handleCourseSave() {
  const title = qs("course-title")?.value.trim();
  const description = qs("course-description")?.value.trim();
  const category = qs("course-category")?.value.trim();
  const level = qs("course-level")?.value.trim();
  const duration = qs("course-duration")?.value.trim();
  const xpValue = qs("course-xp")?.value.trim();
  const isPublic = qs("course-public")?.checked;
  const outline = collectOutline();
  setError();
  if (!title) {
    setError("Введите название курса.");
    return;
  }
  try {
    await api("/api/training/courses", {
      method: "POST",
      body: JSON.stringify({
        title,
        description,
        category,
        level,
        duration,
        xp_value: xpValue,
        is_public: isPublic,
        outline,
      }),
    });
    qs("course-title").value = "";
    qs("course-description").value = "";
    qs("course-category").value = "";
    qs("course-level").value = "";
    qs("course-duration").value = "";
    qs("course-xp").value = "";
    qs("course-public").checked = true;
    qs("course-outline").innerHTML = "";
    await loadAdminData();
  } catch (err) {
    setError(err.message);
  }
}

async function handleCourseDelete(event) {
  const button = event.target.closest("[data-course-delete]");
  if (!button) return;
  const card = button.closest(".lms-admin-course");
  if (!card) return;
  const courseId = card.dataset.courseId;
  if (!confirm("Удалить курс?")) return;
  try {
    await api(`/api/training/courses/${courseId}`, { method: "DELETE" });
    await loadAdminData();
  } catch (err) {
    setError(err.message);
  }
}

async function handleAccessToggle(event) {
  const checkbox = event.target.closest("[data-course-access]");
  if (!checkbox) return;
  const card = checkbox.closest(".lms-admin-course");
  if (!card) return;
  const courseId = card.dataset.courseId;
  const login = checkbox.dataset.login;
  const allowed = checkbox.checked;
  try {
    await api(`/api/training/courses/${courseId}/access`, {
      method: "POST",
      body: JSON.stringify({ login, allowed }),
    });
  } catch (err) {
    checkbox.checked = !allowed;
    setError(err.message);
  }
}

async function handleProgressSave(event) {
  const button = event.target.closest("[data-progress-save]");
  if (!button) return;
  const row = button.closest(".lms-progress-row");
  const card = button.closest(".lms-admin-course");
  if (!row || !card) return;
  const courseId = card.dataset.courseId;
  const login = row.dataset.login;
  const status = row.querySelector("[data-progress-status]")?.value;
  const currentTopic = row.querySelector("[data-progress-topic]")?.value.trim();
  const currentLesson = row
    .querySelector("[data-progress-lesson]")
    ?.value.trim();
  try {
    await api(`/api/training/courses/${courseId}/progress`, {
      method: "POST",
      body: JSON.stringify({
        login,
        status,
        current_topic: currentTopic,
        current_lesson: currentLesson,
      }),
    });
    await loadAdminData();
  } catch (err) {
    setError(err.message);
  }
}

function initOutlineBuilder() {
  const container = qs("course-outline");
  if (!container) return;
  qs("add-topic")?.addEventListener("click", () => {
    container.appendChild(createTopicBlock());
  });
}

function init() {
  initOutlineBuilder();
  loadAdminData().catch((err) => setError(err.message));
  qs("course-save")?.addEventListener("click", handleCourseSave);
  qs("course-admin-list")?.addEventListener("click", (event) => {
    handleCourseDelete(event);
    handleProgressSave(event);
  });
  qs("course-admin-list")?.addEventListener("change", handleAccessToggle);
}

init();
