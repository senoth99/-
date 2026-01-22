const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => Array.from(document.querySelectorAll(selector));

const profileLogin = document.body?.dataset?.profileLogin || "employee";
const role = document.body?.dataset?.role || "employee";
const hasBloggersSettingsAccess =
  document.body?.dataset?.accessBloggersSettings === "true";
const canViewOverallStats = role === "admin" || hasBloggersSettingsAccess;

const state = {
  pools: {
    niches: ["UGC", "Бьюти", "Лайфстайл", "Спорт"],
    formats: ["Инст-фотопост", "Рилс", "ТГ", "UGC", "Тикток", "Твич"],
    products: ['Джерси "Light Classic"'],
    colors: ["Белый", "Черный"],
    sizes: ["S", "M", "L", "XL"],
  },
  bloggers: [
    {
      id: 1,
      name: "Мария Иванова",
      instagram: "instagram.com/maria_fit",
      telegram: "t.me/maria_fit",
      tiktok: "tiktok.com/@maria_fit",
      niche: "UGC",
      category: "Мидл",
      status: "Новый",
      tags: ["UGC", "спорт"],
    },
    {
      id: 2,
      name: "Алексей Громов",
      instagram: "instagram.com/gromov_life",
      telegram: "t.me/gromov_life",
      tiktok: "tiktok.com/@gromovlife",
      niche: "Лайфстайл",
      category: "Крупный",
      status: "Новый",
      tags: ["лайфстайл", "мода"],
    },
    {
      id: 3,
      name: "Анна Миронова",
      instagram: "instagram.com/anna_ugc",
      telegram: "t.me/anna_ugc",
      tiktok: "tiktok.com/@anna_ugc",
      niche: "UGC",
      category: "Микро",
      status: "Новый",
      tags: ["UGC", "beauty"],
    },
  ],
  integrations: [
    {
      id: 1,
      bloggerId: 1,
      agent: profileLogin,
      date: "2024-01-15",
      terms: "Бартер",
      format: "UGC",
      reach: "120000",
      budget: "0",
      ugcStatus: "Сдан",
      items: [
        {
          product: 'Джерси "Light Classic"',
          size: "M",
          color: "Белый",
        },
        {
          product: 'Джерси "Light Classic"',
          size: "S",
          color: "Черный",
        },
      ],
      comment: "Снимаем три коротких ролика.",
      track: "102104",
      contacts: "@maria_fit",
    },
    {
      id: 2,
      bloggerId: 2,
      agent: profileLogin,
      date: "2024-01-20",
      terms: "КМ",
      format: "Инст-фотопост",
      reach: "80000",
      budget: "45000",
      ugcStatus: "Не сдан",
      items: [
        {
          product: 'Джерси "Light Classic"',
          size: "L",
          color: "Черный",
        },
      ],
      comment: "Обсуждается повторная интеграция.",
      track: "",
      contacts: "instagram.com/gromov_life",
    },
  ],
};

let selectedBloggerId = null;
let activeIntegrationId = null;

const toastDurationMs = 10000;
const toastLimit = 3;

const showNotification = (message, type = "info") => {
  if (!message) return;
  const container = qs("#toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-message">${message}</div>
    <button class="toast-close" type="button" aria-label="Скрыть уведомление">×</button>
  `;
  const removeToast = () => {
    toast.classList.add("toast-hide");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  };
  const timer = setTimeout(removeToast, toastDurationMs);
  toast.querySelector(".toast-close").addEventListener("click", () => {
    clearTimeout(timer);
    removeToast();
  });
  container.appendChild(toast);
  const toasts = Array.from(container.querySelectorAll(".toast"));
  if (toasts.length > toastLimit) {
    toasts.slice(0, toasts.length - toastLimit).forEach((oldToast) => {
      oldToast.classList.add("toast-hide");
      oldToast.addEventListener("transitionend", () => oldToast.remove(), {
        once: true,
      });
    });
  }
};

const normalizeText = (value) =>
  (value || "")
    .toString()
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();

const parseNumber = (value) => {
  if (value === null || value === undefined) return 0;
  const normalized = value.toString().replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatInteger = (value) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value || 0);

const formatCurrency = (value) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value || 0);

const formatDateLabel = (value) => {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString("ru-RU");
};

const monthsRu = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];
const weekdaysRu = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const formatMonthLabel = (value) => {
  if (!value) return "—";
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return `${monthsRu[month - 1]} ${year}`;
};

const getTodayValue = () => new Date().toISOString().split("T")[0];

const formatDateDisplay = (value) => {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${String(day).padStart(2, "0")}.${String(month).padStart(
    2,
    "0"
  )}.${year}`;
};

const formatMonthDisplay = (value) => {
  if (!value) return "";
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return `${monthsRu[month - 1]} ${year}`;
};

const getCurrentMonthValue = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
};

const setDefaultDateFields = () => {
  const todayValue = getTodayValue();
  qsa('input[type="date"]').forEach((input) => {
    if (input.dataset.skipDefault === "true") return;
    if (!input.value) input.value = todayValue;
    input.setAttribute("lang", "ru");
    if (!input.getAttribute("placeholder")) {
      input.setAttribute("placeholder", "дд.мм.гг");
    }
  });
  const monthValue = getCurrentMonthValue();
  qsa('input[type="month"]').forEach((input) => {
    if (!input.value) input.value = monthValue;
    input.setAttribute("lang", "ru");
    if (!input.getAttribute("placeholder")) {
      input.setAttribute("placeholder", "мм.гг");
    }
  });
};

const setStatsDateDefaults = () => {
  const monthInput = qs("#stats-month");
  const monthDisplay = qs("#stats-month-display");
  const startInput = qs("#stats-date-start");
  const startDisplay = qs("#stats-date-start-display");
  const endInput = qs("#stats-date-end");
  const endDisplay = qs("#stats-date-end-display");
  const today = getTodayValue();
  const currentMonth = getCurrentMonthValue();

  if (monthInput && !monthInput.value) {
    monthInput.value = currentMonth;
  }
  if (monthDisplay) {
    monthDisplay.value = formatMonthDisplay(monthInput?.value || "");
  }
  if (startInput && !startInput.value) startInput.value = today;
  if (endInput && !endInput.value) endInput.value = today;
  if (startDisplay) startDisplay.value = formatDateDisplay(startInput?.value || "");
  if (endDisplay) endDisplay.value = formatDateDisplay(endInput?.value || "");
};

const renderMonthPicker = (panel, year, selectedMonth) => {
  if (!panel) return;
  panel.innerHTML = `
    <div class="datepicker-header">
      <button type="button" class="datepicker-nav" data-dir="-1">‹</button>
      <span>${year}</span>
      <button type="button" class="datepicker-nav" data-dir="1">›</button>
    </div>
    <div class="datepicker-grid month-grid">
      ${monthsRu
        .map((month, index) => {
          const isActive = index + 1 === selectedMonth;
          return `<button type="button" class="datepicker-cell${
            isActive ? " is-active" : ""
          }" data-month="${index + 1}">${month}</button>`;
        })
        .join("")}
    </div>
  `;
};

const getDaysInMonth = (year, month) => new Date(year, month, 0).getDate();

const renderDatePicker = (panel, year, month, selectedDay) => {
  if (!panel) return;
  const firstDay = new Date(year, month - 1, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = getDaysInMonth(year, month);
  const blanks = Array.from({ length: startOffset }, () => "");
  const days = Array.from({ length: daysInMonth }, (_, idx) => idx + 1);
  panel.innerHTML = `
    <div class="datepicker-header">
      <button type="button" class="datepicker-nav" data-dir="-1">‹</button>
      <span>${monthsRu[month - 1]} ${year}</span>
      <button type="button" class="datepicker-nav" data-dir="1">›</button>
    </div>
    <div class="datepicker-weekdays">
      ${weekdaysRu.map((day) => `<span>${day}</span>`).join("")}
    </div>
    <div class="datepicker-grid">
      ${[...blanks, ...days]
        .map((day) => {
          if (!day) {
            return `<span class="datepicker-blank"></span>`;
          }
          const isActive = day === selectedDay;
          return `<button type="button" class="datepicker-cell${
            isActive ? " is-active" : ""
          }" data-day="${day}">${day}</button>`;
        })
        .join("")}
    </div>
  `;
};

const initStatsDatePickers = () => {
  const panels = qsa(".datepicker-panel");
  if (!panels.length) return;

  const closePanels = () => {
    panels.forEach((panel) => panel.classList.remove("is-open"));
  };

  panels.forEach((panel) => {
    const targetId = panel.dataset.target;
    const displayId = panel.dataset.display;
    const type = panel.dataset.picker;
    const targetInput = targetId ? qs(`#${targetId}`) : null;
    const displayInput = displayId ? qs(`#${displayId}`) : null;
    if (!targetInput || !displayInput) return;

    const openPanel = () => {
      panels.forEach((item) => item.classList.remove("is-open"));
      panel.classList.add("is-open");
      const value = targetInput.value || (type === "month" ? getCurrentMonthValue() : getTodayValue());
      const [year, month, day] = value.split("-").map(Number);
      if (type === "month") {
        panel.dataset.year = String(year);
        renderMonthPicker(panel, year, month);
      } else {
        panel.dataset.year = String(year);
        panel.dataset.month = String(month);
        renderDatePicker(panel, year, month, day);
      }
    };

    displayInput.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = panel.classList.contains("is-open");
      if (isOpen) {
        panel.classList.remove("is-open");
        return;
      }
      openPanel();
    });

    panel.addEventListener("click", (event) => {
      const nav = event.target.closest(".datepicker-nav");
      if (nav) {
        const dir = Number(nav.dataset.dir || 0);
        if (type === "month") {
          const year = Number(panel.dataset.year || getCurrentMonthValue().slice(0, 4));
          const nextYear = year + dir;
          panel.dataset.year = String(nextYear);
          const currentValue = targetInput.value || `${nextYear}-01`;
          const [, currentMonth] = currentValue.split("-").map(Number);
          renderMonthPicker(panel, nextYear, currentMonth || 1);
        } else {
          const year = Number(panel.dataset.year || getTodayValue().slice(0, 4));
          const month = Number(panel.dataset.month || getTodayValue().slice(5, 7));
          const nextDate = new Date(year, month - 1 + dir, 1);
          panel.dataset.year = String(nextDate.getFullYear());
          panel.dataset.month = String(nextDate.getMonth() + 1);
          renderDatePicker(
            panel,
            nextDate.getFullYear(),
            nextDate.getMonth() + 1,
            Number((targetInput.value || getTodayValue()).split("-")[2])
          );
        }
      }

      const monthButton = event.target.closest("[data-month]");
      if (type === "month" && monthButton) {
        const year = Number(panel.dataset.year || getCurrentMonthValue().slice(0, 4));
        const month = Number(monthButton.dataset.month);
        const value = `${year}-${String(month).padStart(2, "0")}`;
        targetInput.value = value;
        displayInput.value = formatMonthDisplay(value);
        panel.classList.remove("is-open");
        renderIntegrationStats();
      }

      const dayButton = event.target.closest("[data-day]");
      if (type === "date" && dayButton) {
        const year = Number(panel.dataset.year || getTodayValue().slice(0, 4));
        const month = Number(panel.dataset.month || getTodayValue().slice(5, 7));
        const day = Number(dayButton.dataset.day);
        const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        targetInput.value = value;
        displayInput.value = formatDateDisplay(value);
        panel.classList.remove("is-open");
        renderIntegrationStats();
      }
    });
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target.closest(".datepicker-panel") || target.closest('[id$="-display"]')) {
      return;
    }
    closePanels();
  });
};

const levenshtein = (a, b) => {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, () => []);
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
};

const fuzzyMatch = (text, query) => {
  if (!query) return true;
  const normalizedText = normalizeText(text);
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;
  if (normalizedText.includes(normalizedQuery)) return true;
  if (normalizedQuery.length <= 2) return false;
  return normalizedText.split(" ").some((word) => {
    if (!word) return false;
    return levenshtein(word, normalizedQuery) <= 2;
  });
};

const openModal = (id, stacked = false) => {
  const modal = qs(`#${id}`);
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.classList.toggle("stacked", stacked);
};

const closeModal = (id) => {
  const modal = qs(`#${id}`);
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("stacked");
};

const updateSelect = (select, options) => {
  if (!select) return;
  select.innerHTML = options
    .map((option) => `<option value="${option}">${option}</option>`)
    .join("");
};

const updatePoolFilters = () => {
  const nicheFilter = qs("#blogger-niche-filter");
  if (nicheFilter) {
    const options = ["Все ниши", ...state.pools.niches];
    nicheFilter.innerHTML = options
      .map((option, index) => {
        const value = index === 0 ? "all" : option;
        return `<option value="${value}">${option}</option>`;
      })
      .join("");
  }
};

const updateFormPools = () => {
  updateSelect(qs("#blogger-niche"), state.pools.niches);
  updateSelect(qs("#integration-format"), state.pools.formats);
  updatePoolFilters();
};

const createSelect = (options, value, allowEmpty = false) => {
  const select = document.createElement("select");
  const items = allowEmpty ? ["", ...options] : options;
  select.innerHTML = items
    .map((option) => {
      const label = option || "Выберите";
      const selected = option === value ? "selected" : "";
      return `<option value="${option}" ${selected}>${label}</option>`;
    })
    .join("");
  return select;
};

const addProductItemRow = (container, item = {}) => {
  if (!container) return;
  const row = document.createElement("div");
  row.className = "item-row";
  const productSelect = createSelect(state.pools.products, item.product || "", true);
  const sizeSelect = createSelect(state.pools.sizes, item.size || "", true);
  const colorSelect = createSelect(state.pools.colors, item.color || "", true);
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "icon-btn danger remove-item";
  removeButton.textContent = "×";
  removeButton.addEventListener("click", () => {
    row.remove();
  });
  row.append(productSelect, sizeSelect, colorSelect, removeButton);
  const addButton = container.querySelector(".add-item");
  if (addButton) {
    container.insertBefore(row, addButton);
    return;
  }
  container.appendChild(row);
};

const renderProductItems = (container, items = []) => {
  if (!container) return;
  const addButton = container.querySelector(".add-item");
  container.innerHTML = "";
  items.forEach((item) => addProductItemRow(container, item));
  if (addButton) {
    container.appendChild(addButton);
  }
};

const collectProductItems = (container) => {
  if (!container) return [];
  const items = Array.from(container.querySelectorAll(".item-row")).map(
    (row) => {
      const selects = row.querySelectorAll("select");
      return {
        product: selects[0]?.value || "",
        size: selects[1]?.value || "",
        color: selects[2]?.value || "",
      };
    }
  );
  return items.filter((item) => item.product || item.size || item.color);
};

const formatProductItems = (items = []) =>
  items
    .filter((item) => item?.product)
    .map((item) => {
      const details = [item.size, item.color].filter(Boolean).join(", ");
      return details ? `${item.product} (${details})` : item.product;
    })
    .join(" / ");

const getPrimaryItem = (items = []) =>
  items.find((item) => item?.product) || { product: "—", size: "", color: "" };

const formatExtraProductItems = (items = []) =>
  formatProductItems(items.filter((_, index) => index > 0));

const renderSettingsPanel = (title, key) => {
  const values = state.pools[key];
  return `
    <div class="settings-panel" data-pool="${key}">
      <h4>${title}</h4>
      <div class="tag-list">
        ${values
          .map(
            (value, index) => `
              <span class="tag">
                ${value}
                <button type="button" data-remove-tag="${index}">✕</button>
              </span>
            `
          )
          .join("")}
      </div>
      <div class="tag-input">
        <input type="text" placeholder="Добавить значение" />
        <button class="secondary" type="button" data-add-tag>Добавить</button>
      </div>
    </div>
  `;
};

const renderSettings = () => {
  const grid = qs("#settings-grid");
  if (!grid) return;
  grid.innerHTML = [
    renderSettingsPanel("Ниши", "niches"),
    renderSettingsPanel("Форматы интеграций", "formats"),
    renderSettingsPanel("Изделия", "products"),
    renderSettingsPanel("Цвета", "colors"),
    renderSettingsPanel("Размеры", "sizes"),
  ].join("");
};

const renderBloggerList = () => {
  const list = qs("#blogger-list");
  if (!list) return;
  const query = qs("#blogger-search")?.value || "";
  const category = qs("#blogger-category-filter")?.value || "all";
  const niche = qs("#blogger-niche-filter")?.value || "all";

  const filtered = state.bloggers.filter((blogger) => {
    const haystack = [
      blogger.name,
      blogger.instagram,
      blogger.telegram,
      blogger.tiktok,
      blogger.niche,
      blogger.category,
      ...(blogger.tags || []),
    ].join(" ");
    const matchesQuery = fuzzyMatch(haystack, query);
    const matchesCategory = category === "all" || blogger.category === category;
    const matchesNiche = niche === "all" || blogger.niche === niche;
    return matchesQuery && matchesCategory && matchesNiche;
  });

  list.innerHTML = filtered
    .map(
      (blogger) => `
        <div class="info-card" data-blogger-id="${blogger.id}">
          <h4>${blogger.name}</h4>
          <div class="info-meta">
            <span>${blogger.instagram}</span>
            <span>${blogger.telegram}</span>
            <span>${blogger.tiktok}</span>
          </div>
          <div class="pill-row">
            <span class="pill">${blogger.niche}</span>
            <span class="pill neutral">${blogger.category}</span>
            ${(blogger.tags || [])
              .map((tag) => `<span class="pill neutral">${tag}</span>`)
              .join("")}
          </div>
        </div>
      `
    )
    .join("");
};

const renderBloggerPicker = () => {
  const picker = qs("#blogger-picker-list");
  if (!picker) return;
  const query = qs("#blogger-picker-search")?.value || "";
  const filtered = state.bloggers.filter((blogger) => {
    const haystack = [
      blogger.name,
      blogger.instagram,
      blogger.telegram,
      blogger.tiktok,
      blogger.niche,
      ...(blogger.tags || []),
    ].join(" ");
    return fuzzyMatch(haystack, query);
  });
  picker.innerHTML = filtered
    .map(
      (blogger) => `
        <div class="picker-item" data-picker-id="${blogger.id}">
          <strong>${blogger.name}</strong>
          <span>${blogger.instagram || blogger.telegram || blogger.tiktok}</span>
        </div>
      `
    )
    .join("");
};

const getBaseFilteredIntegrations = () => {
  const query = qs("#integration-search")?.value || "";
  const format = qs("#integration-format-filter")?.value || "all";
  const terms = qs("#integration-terms-filter")?.value || "all";
  const date = qs("#integration-date-filter")?.value || "";
  return state.integrations.filter((integration) => {
    const blogger = state.bloggers.find((item) => item.id === integration.bloggerId);
    const itemsLabel = formatProductItems(integration.items || []);
    const haystack = [
      blogger?.name,
      blogger?.instagram,
      integration.format,
      integration.terms,
      integration.reach,
      integration.budget,
      itemsLabel,
      integration.comment,
      integration.track,
    ].join(" ");
    const matchesQuery = fuzzyMatch(haystack, query);
    const matchesFormat = format === "all" || integration.format === format;
    const matchesTerms = terms === "all" || integration.terms === terms;
    const matchesDate = !date || integration.date === date;
    return matchesQuery && matchesFormat && matchesTerms && matchesDate;
  });
};

const renderIntegrationList = () => {
  const list = qs("#integration-list");
  if (!list) return;
  const filtered = getBaseFilteredIntegrations();

  list.innerHTML = filtered
    .map((integration) => {
      const blogger = state.bloggers.find((item) => item.id === integration.bloggerId);
      const dateLabel = formatDateLabel(integration.date);
      const primaryItem = getPrimaryItem(integration.items || []);
      const extraCount = (integration.items || []).filter((_, index) => index > 0).length;
      const extraLabel = extraCount ? ` + ещё ${extraCount}` : "";
      return `
        <div class="info-card" data-integration-id="${integration.id}">
          <h4>${blogger?.name || "Блогер"}</h4>
          <div class="info-meta">
            <span>Формат: ${integration.format}</span>
            <span>Условия: ${integration.terms}</span>
            <span>Дата: ${dateLabel}</span>
            <span>Бюджет: ${integration.budget || "—"}</span>
            <span>Охват: ${integration.reach ? formatInteger(parseNumber(integration.reach)) : "—"}</span>
          </div>
          <div class="pill-row">
            <span class="pill">${primaryItem.product}${extraLabel}</span>
          </div>
        </div>
      `;
    })
    .join("");
};

const getMonthKey = (dateValue) => {
  if (!dateValue) return "";
  return dateValue.slice(0, 7);
};

const renderIntegrationStats = () => {
  const countEl = qs("#stats-count");
  if (!countEl) return;
  const selectedMonth = qs("#stats-month")?.value || "";
  const subfilter = qs("#stats-subfilter");
  const startDate = qs("#stats-date-start")?.value || "";
  const endDate = qs("#stats-date-end")?.value || "";
  const isSubfilterActive = subfilter && subfilter.classList.contains("is-open");
  const filtered = getBaseFilteredIntegrations().filter((integration) => {
    if (!canViewOverallStats && integration.agent !== profileLogin) {
      return false;
    }
    const month = getMonthKey(integration.date);
    if (!month) return false;
    if (selectedMonth && month !== selectedMonth) return false;
    if (isSubfilterActive && startDate && integration.date < startDate) return false;
    if (isSubfilterActive && endDate && integration.date > endDate) return false;
    return true;
  });

  const totals = filtered.reduce(
    (acc, integration) => {
      acc.budget += parseNumber(integration.budget);
      acc.reach += parseNumber(integration.reach);
      acc.count += 1;
      const manager = integration.agent || "Не указан";
      acc.managers[manager] = (acc.managers[manager] || 0) + 1;
      return acc;
    },
    { budget: 0, reach: 0, count: 0, managers: {} }
  );

  const cpm =
    totals.reach > 0 ? Math.round((totals.budget / totals.reach) * 1000) : null;
  const bestManager = Object.entries(totals.managers).sort((a, b) => b[1] - a[1])[0];
  const periodLabel = (() => {
    if (isSubfilterActive && (startDate || endDate)) {
      return `${formatDateLabel(startDate)} — ${formatDateLabel(endDate)}`;
    }
    return formatMonthLabel(selectedMonth);
  })();

  countEl.textContent = formatInteger(totals.count);
  qs("#stats-budget").textContent = totals.count
    ? formatCurrency(totals.budget)
    : "—";
  qs("#stats-reach").textContent = totals.count
    ? formatInteger(totals.reach)
    : "—";
  qs("#stats-cpm").textContent = cpm ? formatCurrency(cpm) : "—";
  qs("#stats-best-name").textContent = bestManager
    ? `${bestManager[0]} · ${bestManager[1]} интеграций`
    : "—";
  qs("#stats-best-period").textContent = `За период ${periodLabel}`;
  const scopeNote = qs("#stats-scope-note");
  if (scopeNote) {
    scopeNote.textContent = canViewOverallStats
      ? "Показана общая статистика по всем менеджерам."
      : "Показана статистика только по вашим интеграциям.";
  }
};

const refreshIntegrationViews = () => {
  renderIntegrationList();
  renderIntegrationStats();
};

const exportIntegrations = () => {
  const headers = [
    "Дата",
    "Агент",
    "Ссылка на соц. сеть",
    "Статус блогера",
    "Ниша",
    "Категория",
    "Условия сотрудничества",
    "Формат интеграции",
    "Охват",
    "Бюджет",
    "CPM",
    "UGC",
    "Изделие",
    "Размер",
    "Цвет",
    "Доп. изделия",
    "Комментарий",
    "Трек-номер",
    "Контакты",
  ];

  const rows = getBaseFilteredIntegrations().map((integration) => {
    const blogger = state.bloggers.find((item) => item.id === integration.bloggerId);
    const link =
      blogger?.instagram || blogger?.telegram || blogger?.tiktok || "—";
    const budget = parseNumber(integration.budget);
    const reach = parseNumber(integration.reach);
    const cpm = reach > 0 ? Math.round((budget / reach) * 1000) : "";
    const primaryItem = getPrimaryItem(integration.items || []);
    const extraItems = formatExtraProductItems(integration.items || []);
    return [
      integration.date || "",
      integration.agent || "",
      link,
      blogger?.status || "Новый",
      blogger?.niche || "",
      blogger?.category || "",
      integration.terms || "",
      integration.format || "",
      reach || "",
      budget || "",
      cpm,
      integration.ugcStatus || "",
      primaryItem.product || "",
      primaryItem.size || "",
      primaryItem.color || "",
      extraItems,
      integration.comment || "",
      integration.track || "",
      integration.contacts || "",
    ];
  });

  const escapeValue = (value) => {
    const stringValue = String(value ?? "");
    if (stringValue.includes('"')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    if (stringValue.includes(";") || stringValue.includes("\n")) {
      return `"${stringValue}"`;
    }
    return stringValue;
  };

  const csvContent = [headers, ...rows]
    .map((row) => row.map(escapeValue).join(";"))
    .join("\n");

  const blob = new Blob([`\ufeff${csvContent}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "integrations_export.csv";
  link.click();
  URL.revokeObjectURL(url);
  showNotification("Таблица интеграций сформирована.", "success");
};

const renderBloggerDetail = (bloggerId) => {
  const blogger = state.bloggers.find((item) => item.id === bloggerId);
  if (!blogger) return;
  qs("#blogger-detail-name").textContent = blogger.name;
  qs("#blogger-detail-subtitle").textContent = `${blogger.niche} • ${blogger.category}`;
  qs("#blogger-detail-info").innerHTML = [
    `<div><strong>Instagram</strong>${blogger.instagram || "—"}</div>`,
    `<div><strong>Telegram</strong>${blogger.telegram || "—"}</div>`,
    `<div><strong>TikTok</strong>${blogger.tiktok || "—"}</div>`,
    `<div><strong>Теги</strong>${(blogger.tags || []).join(", ") || "—"}</div>`,
  ].join("");

  const integrations = state.integrations.filter(
    (integration) => integration.bloggerId === bloggerId
  );
  const container = qs("#blogger-detail-integrations");
  if (container) {
    container.innerHTML = integrations.length
      ? integrations
          .map(
            (integration) => `
            <div class="info-card">
              <h4>${integration.format}</h4>
              <div class="info-meta">
                <span>${formatDateLabel(integration.date)}</span>
                <span>UGC: ${integration.ugcStatus}</span>
              </div>
              <div class="pill-row">
                <span class="pill">${formatProductItems(integration.items || []) || "—"}</span>
              </div>
            </div>
          `
          )
          .join("")
      : "<p class='subtitle'>Интеграций пока нет.</p>";
  }
};

const resetBloggerForm = () => {
  [
    "#blogger-name",
    "#blogger-instagram",
    "#blogger-telegram",
    "#blogger-tiktok",
  ].forEach((selector) => {
    const field = qs(selector);
    if (field) field.value = "";
  });
  const niche = qs("#blogger-niche");
  if (niche) niche.value = state.pools.niches[0];
  const category = qs("#blogger-category");
  if (category) category.value = "Микро";
};

const addBlogger = () => {
  const name = qs("#blogger-name")?.value.trim();
  if (!name) return;
  const blogger = {
    id: Date.now(),
    name,
    instagram: qs("#blogger-instagram")?.value.trim() || "",
    telegram: qs("#blogger-telegram")?.value.trim() || "",
    tiktok: qs("#blogger-tiktok")?.value.trim() || "",
    niche: qs("#blogger-niche")?.value || state.pools.niches[0],
    category: qs("#blogger-category")?.value || "Микро",
    status: "Новый",
    tags: [qs("#blogger-niche")?.value || ""].filter(Boolean),
  };
  state.bloggers.unshift(blogger);
  resetBloggerForm();
  updateFormPools();
  renderBloggerList();
  renderBloggerPicker();
  if (qs("#integration-blogger")) {
    selectedBloggerId = blogger.id;
    qs("#integration-blogger").value = blogger.name;
  }
  showNotification("Блогер добавлен в базу.", "success");
};

const openIntegrationModal = () => {
  selectedBloggerId = null;
  const input = qs("#integration-blogger");
  if (input) input.value = "";
  const reach = qs("#integration-reach");
  if (reach) reach.value = "";
  const agent = qs("#integration-agent");
  if (agent) agent.value = profileLogin;
  const date = qs("#integration-date");
  if (date) {
    date.value = getTodayValue();
  }
  const productList = qs("#integration-products-list");
  renderProductItems(productList, []);
  if (productList && !productList.querySelector(".item-row")) {
    addProductItemRow(productList, {});
  }
  qs("#blogger-dropdown")?.classList.remove("is-open");
  openModal("integration-modal");
  renderBloggerPicker();
};

const saveIntegration = () => {
  if (!selectedBloggerId) return;
  const integration = {
    id: Date.now(),
    bloggerId: selectedBloggerId,
    agent: profileLogin,
    date: qs("#integration-date")?.value || "",
    terms: qs("#integration-terms")?.value || "",
    format: qs("#integration-format")?.value || "",
    reach: qs("#integration-reach")?.value.trim() || "",
    budget: qs("#integration-budget")?.value.trim() || "",
    ugcStatus: qs("#integration-ugc")?.value || "",
    items: collectProductItems(qs("#integration-products-list")),
    comment: qs("#integration-comment")?.value.trim() || "",
    track: qs("#integration-track")?.value.trim() || "",
    contacts: qs("#integration-contacts")?.value.trim() || "",
  };
  state.integrations.unshift(integration);
  closeModal("integration-modal");
  refreshIntegrationViews();
  showNotification("Интеграция сохранена.", "success");
};

const openIntegrationDetail = (integrationId) => {
  const integration = state.integrations.find((item) => item.id === integrationId);
  if (!integration) return;
  activeIntegrationId = integrationId;
  const blogger = state.bloggers.find((item) => item.id === integration.bloggerId);
  qs("#integration-detail-title").textContent =
    blogger?.name || "Интеграция";
  const container = qs("#integration-detail-fields");
  if (!container) return;
  const fields = [
    ["Блогер", "integration-detail-blogger", blogger?.name || ""],
    ["Агент", "integration-detail-agent", integration.agent],
    ["Дата", "integration-detail-date", integration.date, "date"],
    ["Условия", "integration-detail-terms", integration.terms],
    ["Формат", "integration-detail-format", integration.format],
    ["Охваты", "integration-detail-reach", integration.reach, "number"],
    ["Бюджет", "integration-detail-budget", integration.budget],
    ["UGC", "integration-detail-ugc", integration.ugcStatus],
  ]
    .map(([label, id, value, type]) => {
      const inputType = type || "text";
      const extraAttrs =
        inputType === "date" ? ' lang="ru" placeholder="дд.мм.гг"' : "";
      return `
        <label>
          ${label}
          <input type="${inputType}" id="${id}" value="${value || ""}"${extraAttrs} />
        </label>
      `;
    })
    .join("");
  container.innerHTML = `
    ${fields}
    <div class="full items-block">
      <div class="extra-products-header">
        <span>Изделия (основное и доп.)</span>
      </div>
      <div class="items-list" id="integration-products-detail-list">
        <button class="ghost small add-item" type="button" id="add-product-item-detail">
          + Добавить изделие
        </button>
      </div>
    </div>
    <label class="full">
      Комментарий
      <input type="text" id="integration-detail-comment" value="${integration.comment || ""}" />
    </label>
    <label class="full">
      Трек номер
      <input type="text" id="integration-detail-track" value="${integration.track || ""}" />
    </label>
    <label class="full">
      Контакты
      <input type="text" id="integration-detail-contacts" value="${integration.contacts || ""}" />
    </label>
  `;
  renderProductItems(qs("#integration-products-detail-list"), integration.items || []);
  const detailList = qs("#integration-products-detail-list");
  if (detailList && !detailList.querySelector(".item-row")) {
    addProductItemRow(detailList, {});
  }
  qs("#add-product-item-detail")?.addEventListener("click", () => {
    addProductItemRow(qs("#integration-products-detail-list"), {});
  });
  openModal("integration-detail-modal");
};

const saveIntegrationDetail = () => {
  if (!activeIntegrationId) return;
  const integration = state.integrations.find((item) => item.id === activeIntegrationId);
  if (!integration) return;
  integration.agent = qs("#integration-detail-agent")?.value.trim() || integration.agent;
  integration.date = qs("#integration-detail-date")?.value || integration.date;
  integration.terms = qs("#integration-detail-terms")?.value.trim() || integration.terms;
  integration.format = qs("#integration-detail-format")?.value.trim() || integration.format;
  integration.reach = qs("#integration-detail-reach")?.value.trim() || integration.reach;
  integration.budget = qs("#integration-detail-budget")?.value.trim() || integration.budget;
  integration.ugcStatus = qs("#integration-detail-ugc")?.value.trim() || integration.ugcStatus;
  integration.items = collectProductItems(qs("#integration-products-detail-list"));
  integration.comment =
    qs("#integration-detail-comment")?.value.trim() || integration.comment;
  integration.track = qs("#integration-detail-track")?.value.trim() || integration.track;
  integration.contacts =
    qs("#integration-detail-contacts")?.value.trim() || integration.contacts;
  closeModal("integration-detail-modal");
  refreshIntegrationViews();
  showNotification("Изменения по интеграции сохранены.", "success");
};

const initSettingsInteractions = () => {
  const grid = qs("#settings-grid");
  if (!grid) return;
  grid.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-add-tag]");
    if (addButton) {
      const panel = addButton.closest("[data-pool]");
      if (!panel) return;
      const input = panel.querySelector("input");
      const value = input?.value.trim();
      if (!value) return;
      const poolKey = panel.dataset.pool;
      if (!state.pools[poolKey].includes(value)) {
        state.pools[poolKey].push(value);
      }
      input.value = "";
      renderSettings();
      updateFormPools();
      renderBloggerList();
      renderBloggerPicker();
      showNotification("Новое значение добавлено в настройки.", "success");
    }
    const removeButton = event.target.closest("[data-remove-tag]");
    if (removeButton) {
      const panel = removeButton.closest("[data-pool]");
      if (!panel) return;
      const poolKey = panel.dataset.pool;
      const index = Number(removeButton.dataset.removeTag);
      state.pools[poolKey].splice(index, 1);
      renderSettings();
      updateFormPools();
      renderBloggerList();
      renderBloggerPicker();
      showNotification("Значение удалено из настроек.", "info");
    }
  });
};

const applyViewMode = (container, mode) => {
  if (!container) return;
  container.classList.toggle("is-list", mode === "list");
  container.classList.toggle("is-grid", mode === "grid");
};

const initViewToggles = () => {
  const toggles = qsa("[data-view-toggle]");
  if (!toggles.length) return;
  toggles.forEach((toggle) => {
    const targetSelector = toggle.dataset.viewToggle;
    const container = qs(targetSelector);
    if (!container) return;
    const buttons = Array.from(toggle.querySelectorAll("[data-view]"));
    const defaultView = toggle.dataset.defaultView || "list";
    applyViewMode(container, defaultView);
    buttons.forEach((button) => {
      const isActive = button.dataset.view === defaultView;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive);
      button.addEventListener("click", () => {
        const view = button.dataset.view;
        applyViewMode(container, view);
        buttons.forEach((btn) => {
          const active = btn === button;
          btn.classList.toggle("is-active", active);
          btn.setAttribute("aria-pressed", active);
        });
      });
    });
  });
};

const initBloggersTabs = () => {
  const tabs = qsa("[data-bloggers-tab]");
  const panels = qsa("[data-bloggers-section]");
  if (!tabs.length || !panels.length) return;

  const setActiveTab = (target) => {
    panels.forEach((panel) => {
      const isActive = panel.dataset.bloggersSection === target;
      panel.classList.toggle("hidden", !isActive);
    });

    tabs.forEach((tab) => {
      const isActive = tab.dataset.bloggersTab === target;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-pressed", isActive);
      const cta = tab.querySelector("[data-tab-cta]");
      if (cta) {
        cta.textContent = isActive ? "Открыто" : "Открыть →";
      }
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => setActiveTab(tab.dataset.bloggersTab));
  });

  setActiveTab(tabs[0].dataset.bloggersTab);
};

const initBasePage = () => {
  if (!qs("#blogger-base")) return;
  renderSettings();
  updateFormPools();
  renderBloggerList();

  qs("#open-add-blogger")?.addEventListener("click", () => {
    resetBloggerForm();
    openModal("blogger-modal");
  });

  qs("#save-blogger")?.addEventListener("click", () => {
    addBlogger();
    closeModal("blogger-modal");
  });

  ["#blogger-search", "#blogger-category-filter", "#blogger-niche-filter"].forEach(
    (selector) => {
      qs(selector)?.addEventListener("input", renderBloggerList);
      qs(selector)?.addEventListener("change", renderBloggerList);
    }
  );

  qs("#blogger-list")?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-blogger-id]");
    if (!card) return;
    const bloggerId = Number(card.dataset.bloggerId);
    renderBloggerDetail(bloggerId);
    openModal("blogger-detail-modal");
  });
};

const initSettingsPage = () => {
  if (!qs("#blogger-settings")) return;
  renderSettings();
  updateFormPools();
};

const initIntegrationsPage = () => {
  if (!qs("#integrations-actions")) return;
  updateFormPools();
  renderBloggerPicker();
  refreshIntegrationViews();

  const monthInput = qs("#stats-month");
  const dateStart = qs("#stats-date-start");
  const dateEnd = qs("#stats-date-end");
  const subfilter = qs("#stats-subfilter");
  const toggleSubfilter = qs("#toggle-stats-subfilter");
  setDefaultDateFields();
  setStatsDateDefaults();
  initStatsDatePickers();
  toggleSubfilter?.addEventListener("click", () => {
    const isOpen = subfilter?.classList.contains("is-open");
    subfilter?.classList.toggle("is-open", !isOpen);
    toggleSubfilter?.classList.toggle("is-open", !isOpen);
    toggleSubfilter?.setAttribute("aria-expanded", isOpen ? "false" : "true");
    if (!isOpen && monthInput && dateStart && dateEnd) {
      if (!dateStart.value && monthInput.value) {
        dateStart.value = `${monthInput.value}-01`;
      }
      if (!dateEnd.value && monthInput.value) {
        dateEnd.value = `${monthInput.value}-31`;
      }
    }
  });
  renderIntegrationStats();

  qs("#open-integration-modal")?.addEventListener("click", openIntegrationModal);
  qs("#save-integration")?.addEventListener("click", saveIntegration);

  const pickerPanel = qs("#blogger-picker");
  const pickerDropdown = qs("#blogger-dropdown");
  const pickerInput = qs("#integration-blogger");
  const openPicker = () => {
    pickerDropdown?.classList.add("is-open");
    renderBloggerPicker();
    qs("#blogger-picker-search")?.focus();
  };
  const closePicker = () => {
    pickerDropdown?.classList.remove("is-open");
  };
  const togglePicker = () => {
    if (!pickerDropdown) return;
    const isOpen = pickerDropdown.classList.contains("is-open");
    if (isOpen) {
      closePicker();
      return;
    }
    openPicker();
  };
  pickerInput?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePicker();
  });
  document.addEventListener("click", (event) => {
    if (!pickerDropdown || !pickerDropdown.classList.contains("is-open")) return;
    const target = event.target;
    if (
      pickerDropdown.contains(target) ||
      pickerInput?.contains(target) ||
      target.closest("#blogger-dropdown")
    ) {
      return;
    }
    closePicker();
  });

  qs("#blogger-picker-search")?.addEventListener("input", renderBloggerPicker);
  qs("#blogger-picker-list")?.addEventListener("click", (event) => {
    const item = event.target.closest("[data-picker-id]");
    if (!item) return;
    const id = Number(item.dataset.pickerId);
    const blogger = state.bloggers.find((entry) => entry.id === id);
    selectedBloggerId = id;
    if (blogger && qs("#integration-blogger")) {
      qs("#integration-blogger").value = blogger.name;
    }
    closePicker();
  });

  qs("#open-blogger-from-picker")?.addEventListener("click", () => {
    resetBloggerForm();
    openModal("blogger-modal", true);
  });

  qs("#save-blogger")?.addEventListener("click", () => {
    addBlogger();
    closeModal("blogger-modal");
    renderBloggerPicker();
  });

  qs("#add-product-item")?.addEventListener("click", () => {
    addProductItemRow(qs("#integration-products-list"), {});
  });

  [
    "#integration-search",
    "#integration-format-filter",
    "#integration-terms-filter",
    "#integration-date-filter",
  ].forEach((selector) => {
    qs(selector)?.addEventListener("input", refreshIntegrationViews);
    qs(selector)?.addEventListener("change", refreshIntegrationViews);
  });

  qs("#integration-list")?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-integration-id]");
    if (!card) return;
    const integrationId = Number(card.dataset.integrationId);
    openIntegrationDetail(integrationId);
  });

  qs("#save-integration-detail")?.addEventListener("click", saveIntegrationDetail);

  qs("#export-integrations")?.addEventListener("click", () => {
    if (qs("#export-integrations")?.disabled) return;
    exportIntegrations();
  });
};

const initModals = () => {
  document.addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-close-modal]");
    if (closeButton) {
      closeModal(closeButton.dataset.closeModal);
    }
  });
};

const init = () => {
  updateFormPools();
  setDefaultDateFields();
  initSettingsInteractions();
  initBloggersTabs();
  initBasePage();
  initSettingsPage();
  initIntegrationsPage();
  initModals();
  initViewToggles();
};

init();
