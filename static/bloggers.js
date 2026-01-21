const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => Array.from(document.querySelectorAll(selector));

const profileLogin = document.body?.dataset?.profileLogin || "employee";

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
      budget: "0",
      ugcStatus: "Сдан",
      product: 'Джерси "Light Classic"',
      size: "M",
      color: "Белый",
      extraProduct: 'Джерси "Light Classic"',
      extraSize: "S",
      extraColor: "Черный",
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
      budget: "45000",
      ugcStatus: "Не сдан",
      product: 'Джерси "Light Classic"',
      size: "L",
      color: "Черный",
      extraProduct: "—",
      extraSize: "—",
      extraColor: "—",
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
  updateSelect(qs("#integration-product"), state.pools.products);
  updateSelect(qs("#integration-extra-product"), state.pools.products);
  updateSelect(qs("#integration-color"), state.pools.colors);
  updateSelect(qs("#integration-extra-color"), state.pools.colors);
  updateSelect(qs("#integration-size"), state.pools.sizes);
  updateSelect(qs("#integration-extra-size"), state.pools.sizes);
  updatePoolFilters();
};

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

const renderIntegrationList = () => {
  const list = qs("#integration-list");
  if (!list) return;
  const query = qs("#integration-search")?.value || "";
  const format = qs("#integration-format-filter")?.value || "all";
  const terms = qs("#integration-terms-filter")?.value || "all";
  const date = qs("#integration-date-filter")?.value || "";
  const filtered = state.integrations.filter((integration) => {
    const blogger = state.bloggers.find((item) => item.id === integration.bloggerId);
    const haystack = [
      blogger?.name,
      blogger?.instagram,
      integration.format,
      integration.terms,
      integration.budget,
      integration.product,
      integration.color,
      integration.size,
      integration.comment,
      integration.track,
    ].join(" ");
    const matchesQuery = fuzzyMatch(haystack, query);
    const matchesFormat = format === "all" || integration.format === format;
    const matchesTerms = terms === "all" || integration.terms === terms;
    const matchesDate = !date || integration.date === date;
    return matchesQuery && matchesFormat && matchesTerms && matchesDate;
  });

  list.innerHTML = filtered
    .map((integration) => {
      const blogger = state.bloggers.find((item) => item.id === integration.bloggerId);
      return `
        <div class="info-card" data-integration-id="${integration.id}">
          <h4>${blogger?.name || "Блогер"}</h4>
          <div class="info-meta">
            <span>Формат: ${integration.format}</span>
            <span>Условия: ${integration.terms}</span>
            <span>Бюджет: ${integration.budget || "—"}</span>
          </div>
          <div class="pill-row">
            <span class="pill">${integration.product}</span>
            <span class="pill neutral">${integration.color}</span>
            <span class="pill ${integration.ugcStatus === "Сдан" ? "success" : "neutral"}">
              UGC: ${integration.ugcStatus}
            </span>
          </div>
        </div>
      `;
    })
    .join("");
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
                <span>${integration.date || "—"}</span>
                <span>UGC: ${integration.ugcStatus}</span>
              </div>
              <div class="pill-row">
                <span class="pill">${integration.product}</span>
                <span class="pill neutral">${integration.color}</span>
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
  const agent = qs("#integration-agent");
  if (agent) agent.value = profileLogin;
  const date = qs("#integration-date");
  if (date) {
    const today = new Date().toISOString().split("T")[0];
    date.value = today;
  }
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
    budget: qs("#integration-budget")?.value.trim() || "",
    ugcStatus: qs("#integration-ugc")?.value || "",
    product: qs("#integration-product")?.value || "",
    size: qs("#integration-size")?.value || "",
    color: qs("#integration-color")?.value || "",
    extraProduct: qs("#integration-extra-product")?.value || "",
    extraSize: qs("#integration-extra-size")?.value || "",
    extraColor: qs("#integration-extra-color")?.value || "",
    comment: qs("#integration-comment")?.value.trim() || "",
    track: qs("#integration-track")?.value.trim() || "",
    contacts: qs("#integration-contacts")?.value.trim() || "",
  };
  state.integrations.unshift(integration);
  closeModal("integration-modal");
  renderIntegrationList();
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
  container.innerHTML = [
    ["Блогер", "integration-detail-blogger", blogger?.name || ""],
    ["Агент", "integration-detail-agent", integration.agent],
    ["Дата", "integration-detail-date", integration.date, "date"],
    ["Условия", "integration-detail-terms", integration.terms],
    ["Формат", "integration-detail-format", integration.format],
    ["Бюджет", "integration-detail-budget", integration.budget],
    ["UGC", "integration-detail-ugc", integration.ugcStatus],
    ["Изделие", "integration-detail-product", integration.product],
    ["Размер", "integration-detail-size", integration.size],
    ["Цвет", "integration-detail-color", integration.color],
    ["Доп. изделие", "integration-detail-extra", integration.extraProduct],
    ["Комментарий", "integration-detail-comment", integration.comment],
    ["Трек номер", "integration-detail-track", integration.track],
    ["Контакты", "integration-detail-contacts", integration.contacts],
  ]
    .map(([label, id, value, type]) => {
      const inputType = type || "text";
      return `
        <label>
          ${label}
          <input type="${inputType}" id="${id}" value="${value || ""}" />
        </label>
      `;
    })
    .join("");
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
  integration.budget = qs("#integration-detail-budget")?.value.trim() || integration.budget;
  integration.ugcStatus = qs("#integration-detail-ugc")?.value.trim() || integration.ugcStatus;
  integration.product = qs("#integration-detail-product")?.value.trim() || integration.product;
  integration.size = qs("#integration-detail-size")?.value.trim() || integration.size;
  integration.color = qs("#integration-detail-color")?.value.trim() || integration.color;
  integration.extraProduct =
    qs("#integration-detail-extra")?.value.trim() || integration.extraProduct;
  integration.comment =
    qs("#integration-detail-comment")?.value.trim() || integration.comment;
  integration.track = qs("#integration-detail-track")?.value.trim() || integration.track;
  integration.contacts =
    qs("#integration-detail-contacts")?.value.trim() || integration.contacts;
  closeModal("integration-detail-modal");
  renderIntegrationList();
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
  renderIntegrationList();

  qs("#open-integration-modal")?.addEventListener("click", openIntegrationModal);
  qs("#save-integration")?.addEventListener("click", saveIntegration);

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

  [
    "#integration-search",
    "#integration-format-filter",
    "#integration-terms-filter",
    "#integration-date-filter",
  ].forEach((selector) => {
    qs(selector)?.addEventListener("input", renderIntegrationList);
    qs(selector)?.addEventListener("change", renderIntegrationList);
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
    showNotification("Выгрузка таблицы будет доступна в следующем обновлении.", "info");
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
  initSettingsInteractions();
  initBloggersTabs();
  initBasePage();
  initSettingsPage();
  initIntegrationsPage();
  initModals();
  initViewToggles();
};

init();
