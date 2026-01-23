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
  courses: [],
  categories: [],
  activeCategory: "all",
  badges: [],
  profile: null,
};

const statusLabels = {
  not_started: "Не начат",
  in_progress: "В процессе",
  completed: "Пройден",
};

function renderBadges() {
  const container = qs("lms-badges");
  if (!container) return;
  container.innerHTML = "";
  if (!state.badges.length) {
    container.innerHTML = "<span class='subtitle'>Еще нет бейджей</span>";
    return;
  }
  state.badges.slice(0, 4).forEach((badge) => {
    const chip = document.createElement("div");
    chip.className = "lms-badge-chip";
    chip.innerHTML = `🏅 ${badge.badge_label}`;
    container.appendChild(chip);
  });
}

function renderStats() {
  const xpEl = qs("lms-xp");
  const completedEl = qs("lms-completed");
  if (xpEl && state.profile) {
    xpEl.textContent = state.profile.xp || 0;
  }
  if (completedEl) {
    const completedCount = state.courses.filter(
      (course) => course.status === "completed"
    ).length;
    completedEl.textContent = completedCount;
  }
}

function renderFilters() {
  const container = qs("lms-filters");
  if (!container) return;
  const categories = ["all", ...state.categories];
  container.innerHTML = "";
  categories.forEach((category) => {
    const button = document.createElement("button");
    button.className = "secondary lms-filter-btn";
    button.type = "button";
    button.dataset.category = category;
    button.textContent = category === "all" ? "Все" : category;
    if (state.activeCategory === category) {
      button.classList.add("is-active");
    }
    container.appendChild(button);
  });
}

function buildCourseMeta(course) {
  const meta = [];
  if (course.level) meta.push(`Уровень: ${course.level}`);
  if (course.duration) meta.push(`Длительность: ${course.duration}`);
  meta.push(`XP: ${course.xp_value || 0}`);
  meta.push(`Темы: ${course.summary.topics}`);
  meta.push(`Уроки: ${course.summary.lessons}`);
  meta.push(`Тесты: ${course.summary.tests}`);
  return meta;
}

function renderCourses() {
  const container = qs("lms-courses");
  if (!container) return;
  container.innerHTML = "";
  const filtered = state.courses.filter((course) => {
    if (state.activeCategory === "all") return true;
    return (course.category || "") === state.activeCategory;
  });
  if (!filtered.length) {
    container.innerHTML =
      "<p class='subtitle'>Пока нет курсов в этой категории.</p>";
    return;
  }
  filtered.forEach((course) => {
    const card = document.createElement("div");
    card.className = "lms-course-card";
    if (!course.accessible) {
      card.classList.add("is-disabled");
    }
    const statusLabel = statusLabels[course.status] || "Не начат";
    const progressText = course.progress?.current_lesson
      ? `Текущий урок: ${course.progress.current_lesson}`
      : "";
    const meta = buildCourseMeta(course)
      .map((item) => `<span>${item}</span>`)
      .join("");
    card.innerHTML = `
      <div class="lms-course-head">
        <div>
          <span class="lms-course-category">${
            course.category || "Без категории"
          }</span>
          <h3>${course.title}</h3>
          <p class="subtitle">${course.description || "Описание в разработке."}</p>
        </div>
        <span class="lms-course-status ${
          course.status === "completed" ? "is-done" : ""
        }">${statusLabel}</span>
      </div>
      <div class="lms-course-meta">
        ${meta}
      </div>
      <div class="lms-course-footer">
        <div class="lms-course-progress">
          <span>${progressText || "Начните курс, чтобы видеть прогресс."}</span>
        </div>
        <div class="lms-course-actions">
          <button
            class="secondary"
            data-complete-course="${course.id}"
            ${course.status === "completed" || !course.accessible ? "disabled" : ""}
          >
            ${course.status === "completed" ? "Пройден" : "Завершить курс"}
          </button>
        </div>
      </div>
      <div class="lms-course-lock">Недоступно</div>
    `;
    container.appendChild(card);
  });
}

async function loadOverview() {
  const data = await api("/api/training/overview");
  state.courses = data.courses || [];
  state.categories = data.categories || [];
  state.badges = data.badges || [];
  state.profile = data.profile;
  renderBadges();
  renderStats();
  renderFilters();
  renderCourses();
}

async function handleComplete(event) {
  const button = event.target.closest("[data-complete-course]");
  if (!button || button.disabled) return;
  const courseId = button.dataset.completeCourse;
  try {
    await api(`/api/training/courses/${courseId}/complete`, { method: "POST" });
    await loadOverview();
  } catch (err) {
    alert(err.message);
  }
}

function handleFilter(event) {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.activeCategory = button.dataset.category;
  renderFilters();
  renderCourses();
}

function init() {
  loadOverview().catch((err) => console.error(err));
  qs("lms-courses")?.addEventListener("click", handleComplete);
  qs("lms-filters")?.addEventListener("click", handleFilter);
}

init();
