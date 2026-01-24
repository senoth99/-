const state = {
  locations: [],
  shipments: [],
  currentLocationId: null,
  currentShipmentId: null,
};

const modal = (id) => document.getElementById(id);
const qs = (id) => document.getElementById(id);
const role = document.body?.dataset?.role || "employee";
const isAdmin = role === "admin";

const openModal = (id) => modal(id).classList.remove("hidden");
const closeModal = (id) => modal(id).classList.add("hidden");

const formatNumber = (value) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
    value || 0,
  );

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU");
};


const toastDurationMs = 10000;
const toastLimit = 3;

const showNotification = (message, type = "info") => {
  if (!message) return;
  const container = qs("toast-container");
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Ошибка запроса");
  }
  if (response.headers.get("Content-Type")?.includes("application/json")) {
    return response.json();
  }
  return response;
}

async function loadLocations() {
  const data = await api("/api/locations");
  state.locations = data;
  renderLocations();
}

async function loadShipments() {
  const data = await api("/api/shipments");
  state.shipments = data;
  renderShipments();
}

function renderLocations() {
  const grid = qs("location-grid");
  grid.innerHTML = "";
  if (isAdmin) {
    const addCard = document.createElement("button");
    addCard.type = "button";
    addCard.className = "card add-card animated-card admin-only";
    addCard.dataset.addLocation = "true";
    addCard.innerHTML = `
      <span class="add-card-icon">+</span>
      <span class="add-card-text">Добавить точку</span>
    `;
    grid.appendChild(addCard);
  }
  if (!state.locations.length) {
    const emptyCard = document.createElement("div");
    emptyCard.className = "card";
    emptyCard.textContent = "Нет точек продаж. Добавьте первую точку.";
    grid.appendChild(emptyCard);
    return;
  }
  state.locations.forEach((location) => {
    const card = document.createElement("div");
    card.className = "card animated-card";
    const shipmentAction = isAdmin
      ? `
      <button class="secondary" data-add-shipment="${location.id}">
        ➕ Добавить поставку
      </button>
    `
      : "";
    const actions = isAdmin
      ? `
      <div class="card-actions">
        <button class="secondary" data-upload="${location.id}">Импорт</button>
        <button class="light" data-records="${location.id}">Детали</button>
        <button class="light" data-export-location="${location.id}">Экспорт Excel</button>
        <button class="light danger" data-delete-location="${location.id}">
          Удалить
        </button>
      </div>
    `
      : `
      <div class="card-actions">
        <button class="secondary" data-records="${location.id}">Детали</button>
        <button class="light" data-export-location="${location.id}">Экспорт Excel</button>
      </div>
    `;
    card.innerHTML = `
      <h3>${location.name}</h3>
      <div class="meta">${location.address || "Адрес не указан"}</div>
      <div class="stats">
        <div class="stat">Остаток<span>${formatNumber(
          location.total_stock,
        )}</span></div>
        <div class="stat">Продажи<span>${formatNumber(
          location.total_sales_qty,
        )}</span></div>
        <div class="stat">Выручка<span>${formatNumber(
          location.total_sales_amount,
        )}</span></div>
        <div class="stat">Обновление<span>${formatDate(
          location.last_update,
        )}</span></div>
      </div>
      <div class="card-actions primary-actions">
        ${shipmentAction}
      </div>
      ${actions}
    `;
    grid.appendChild(card);
  });
}

function renderShipments() {
  const grid = qs("shipment-grid");
  grid.innerHTML = "";
  if (!state.shipments.length) {
    grid.innerHTML =
      "<div class='card'>Поставки пока не добавлены. Создайте первую поставку.</div>";
    return;
  }
  state.shipments.forEach((shipment) => {
    const card = document.createElement("div");
    card.className = "card shipment-card animated-card";
    card.dataset.shipment = shipment.id;
    const actionButtons = isAdmin
      ? `
        <button class="icon-btn danger" data-delete="${shipment.id}" aria-label="Удалить">×</button>
      `
      : "";
    card.innerHTML = `
      <div class="shipment-actions-left">
        <button class="icon-btn" data-refresh="${shipment.id}" aria-label="Обновить статусы">
          ⟳
        </button>
        ${actionButtons}
      </div>
      <div class="shipment-info">
        <h3>${shipment.display_number || shipment.internal_number || "-"}</h3>
        <div class="shipment-route">${shipment.origin_label} → ${shipment.destination_label}</div>
        <div class="shipment-status">Статус: ${shipment.last_status || "Нет данных"}</div>
        <div class="meta">Локация: ${shipment.last_location || "Локация неизвестна"}</div>
        <div class="meta">Обновлено: ${formatDate(shipment.last_update)}</div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function renderDetailItems(container, items) {
  container.innerHTML = "";
  const filtered = items.filter(
    (item) => item.value !== null && item.value !== undefined && item.value !== "",
  );
  if (!filtered.length) {
    container.innerHTML =
      "<div class='detail-item'><span class='detail-label'>Нет данных</span></div>";
    return;
  }
  filtered.forEach((item) => {
    const block = document.createElement("div");
    block.className = "detail-item";
    block.innerHTML = `
      <span class="detail-label">${item.label}</span>
      <span class="detail-value">${item.value}</span>
    `;
    container.appendChild(block);
  });
}

function renderStatusHistory(container, statuses) {
  container.innerHTML = "";
  if (!statuses?.length) {
    container.innerHTML = "<div class='status-item'>Нет данных по статусам.</div>";
    return;
  }
  statuses.forEach((status) => {
    const item = document.createElement("div");
    item.className = "status-item";
    const title =
      status.name ||
      status.status ||
      status.code ||
      status.status_code ||
      "Статус";
    const location = status.city || status.location || "Локация неизвестна";
    const timestamp = status.date_time || status.timestamp;
    item.innerHTML = `
      <strong>${title}</strong>
      <span class="meta">${location}</span>
      <span class="meta">${formatDate(timestamp)}</span>
    `;
    container.appendChild(item);
  });
}

function renderShipmentDetails(shipment, history = []) {
  if (!shipment) return;
  const title = qs("shipment-detail-title");
  const route = qs("shipment-detail-route");
  const deleteBtn = qs("shipment-detail-delete");
  const cdekLink = qs("shipment-cdek-link");
  const mainContainer = qs("shipment-detail-main");
  const extraContainer = qs("shipment-detail-extra");
  const statusesContainer = qs("shipment-detail-statuses");
  const trackNumber = shipment.display_number || shipment.internal_number || "";

  title.textContent = `Поставка ${trackNumber || shipment.id}`;
  route.textContent = `${shipment.origin_label} → ${shipment.destination_label}`;
  deleteBtn.dataset.delete = shipment.id;
  cdekLink.href = trackNumber
    ? `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(trackNumber)}`
    : "https://www.cdek.ru/ru/tracking";

  mainContainer.innerHTML =
    "<div class='detail-item'><span class='detail-label'>Данные по поставке</span></div>";
  extraContainer.innerHTML =
    "<div class='detail-item'><span class='detail-label'>Дополнительные данные</span></div>";

  renderDetailItems(mainContainer, [
    { label: "Статус", value: shipment.last_status || "Нет данных" },
    { label: "Последнее обновление", value: formatDate(shipment.last_update) },
    { label: "Локация", value: shipment.last_location || "Локация неизвестна" },
    { label: "Трек-номер", value: trackNumber || "Не задан" },
  ]);
  renderDetailItems(extraContainer, [
    {
      label: "Источник",
      value: trackNumber ? "CDEK" : "Отслеживание CDEK отключено",
    },
  ]);
  renderStatusHistory(statusesContainer, history);
}

async function loadShipmentHistory(shipmentId) {
  return api(`/api/shipments/${shipmentId}/history`);
}

async function openShipmentDetails(shipmentId) {
  const shipment = state.shipments.find((item) => item.id === shipmentId);
  if (!shipment) return;
  state.currentShipmentId = shipmentId;
  const statusesContainer = qs("shipment-detail-statuses");
  statusesContainer.innerHTML =
    "<div class='status-item'>Загружаем историю статусов...</div>";
  openModal("shipment-details-modal");
  renderShipmentDetails(shipment, []);
  try {
    const history = await loadShipmentHistory(shipmentId);
    renderShipmentDetails(shipment, history);
  } catch (err) {
    statusesContainer.innerHTML = `<div class='status-item'>${err.message}</div>`;
  }
}

async function refreshShipment(shipmentId) {
  try {
    const data = await api(`/api/shipments/${shipmentId}/refresh`, {
      method: "POST",
    });
    const updatedShipment = data.shipment;
    state.shipments = state.shipments.map((item) =>
      item.id === updatedShipment.id ? updatedShipment : item,
    );
    renderShipments();
    if (state.currentShipmentId === shipmentId) {
      renderShipmentDetails(updatedShipment, data.history || []);
    }
    showNotification("Статусы обновлены", "success");
  } catch (err) {
    showNotification(err.message, "error");
  }
}

async function handleAddLocation() {
  const name = qs("location-name").value.trim();
  const address = qs("location-address").value.trim();
  const error = qs("location-error");
  error.textContent = "";
  try {
    await api("/api/locations", {
      method: "POST",
      body: JSON.stringify({ name, address }),
    });
    qs("location-name").value = "";
    qs("location-address").value = "";
    closeModal("location-modal");
    await loadLocations();
    showNotification("Точка продаж добавлена.", "success");
  } catch (err) {
    error.textContent = err.message;
    showNotification(err.message, "error");
  }
}

function openShipmentModal(originLabel = null) {
  const origin = qs("shipment-origin");
  const destination = qs("shipment-destination");
  const options = [
    { value: "Склад", label: "Склад" },
    ...state.locations.map((location) => ({
      value: location.name,
      label: location.name,
    })),
  ];
  origin.innerHTML = "";
  destination.innerHTML = "";
  options.forEach((option) => {
    const originOption = document.createElement("option");
    originOption.value = option.value;
    originOption.textContent = option.label;
    origin.appendChild(originOption);
    const destinationOption = document.createElement("option");
    destinationOption.value = option.value;
    destinationOption.textContent = option.label;
    destination.appendChild(destinationOption);
  });
  if (originLabel) {
    origin.value = originLabel;
  }
  qs("shipment-display-number").value = "";
  qs("shipment-error").textContent = "";
  openModal("shipment-modal");
}

async function handleAddShipment() {
  const origin = qs("shipment-origin").value;
  const destination = qs("shipment-destination").value;
  const displayNumber = qs("shipment-display-number").value.trim();
  const error = qs("shipment-error");
  error.textContent = "";
  try {
    await api("/api/shipments", {
      method: "POST",
      body: JSON.stringify({
        origin_label: origin,
        destination_label: destination,
        display_number: displayNumber,
      }),
    });
    closeModal("shipment-modal");
    await loadShipments();
    showNotification("Поставка добавлена.", "success");
  } catch (err) {
    error.textContent = err.message;
    showNotification(err.message, "error");
  }
}

async function openUpload(locationId) {
  state.currentLocationId = locationId;
  const location = state.locations.find((item) => item.id === locationId);
  qs("upload-location").textContent = `Точка: ${location?.name || ""}`;
  qs("upload-error").textContent = "";
  qs("upload-file").value = "";
  openModal("upload-modal");
}

async function submitUpload() {
  const fileInput = qs("upload-file");
  const error = qs("upload-error");
  error.textContent = "";
  if (!fileInput.files.length) {
    error.textContent = "Выберите файл Excel или CSV";
    return;
  }
  const formData = new FormData();
  formData.append("location_id", state.currentLocationId);
  formData.append("file", fileInput.files[0]);
  try {
    const response = await fetch("/api/upload", { method: "POST", body: formData });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Ошибка загрузки");
    }
    closeModal("upload-modal");
    await loadLocations();
    showNotification("Файл успешно импортирован.", "success");
  } catch (err) {
    error.textContent = err.message;
    showNotification(err.message, "error");
  }
}

async function openRecords(locationId) {
  const location = state.locations.find((item) => item.id === locationId);
  qs("records-title").textContent = location?.name || "Детали точки";
  const body = qs("records-body");
  body.innerHTML = "";
  try {
    const records = await api(`/api/records/${locationId}`);
    if (!records.length) {
      body.innerHTML = "<tr><td colspan='6'>Нет данных</td></tr>";
    } else {
      records.forEach((record) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${record.product}</td>
          <td>${formatNumber(record.stock)}</td>
          <td>${formatNumber(record.sales_qty)}</td>
          <td>${formatNumber(record.sales_amount)}</td>
          <td>${record.record_date || "-"}</td>
          <td>${record.source_file || "-"}</td>
        `;
        body.appendChild(row);
      });
    }
    openModal("records-modal");
  } catch (err) {
    body.innerHTML = `<tr><td colspan='6'>${err.message}</td></tr>`;
  }
}

const sanitizeFilename = (value) =>
  value
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);

async function exportLocationExcel(locationId) {
  const location = state.locations.find((item) => item.id === locationId);
  const response = await fetch(`/api/export/${locationId}`);
  if (!response.ok) {
    showNotification("Ошибка экспорта.", "error");
    return;
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const name = location?.name ? sanitizeFilename(location.name) : "location";
  link.download = `export_${name}.xlsx`;
  link.click();
  window.URL.revokeObjectURL(url);
  showNotification("Экспорт Excel начался.", "info");
}

async function deleteShipment(shipmentId) {
  try {
    await api(`/api/shipments/${shipmentId}`, { method: "DELETE" });
    await loadShipments();
    if (state.currentShipmentId === shipmentId) {
      closeModal("shipment-details-modal");
      state.currentShipmentId = null;
    }
    showNotification("Поставка удалена.", "info");
  } catch (err) {
    showNotification(err.message, "error");
  }
}

async function deleteLocation(locationId) {
  try {
    await api(`/api/locations/${locationId}`, { method: "DELETE" });
    await loadLocations();
    showNotification("Точка продаж удалена.", "info");
  } catch (err) {
    showNotification(err.message, "error");
  }
}

function registerEvents() {
  if (isAdmin) {
    qs("location-save").addEventListener("click", handleAddLocation);
    qs("shipment-save").addEventListener("click", handleAddShipment);
    qs("upload-submit").addEventListener("click", submitUpload);
  }
  qs("logout-btn")?.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    window.location.href = "/login";
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    const actionTarget = target.closest(
      "[data-close],[data-upload],[data-records],[data-delete],[data-delete-location],[data-shipment],[data-add-location],[data-add-shipment],[data-export-location],[data-refresh]",
    );
    if (!actionTarget) {
      return;
    }
    if (actionTarget.dataset.close) {
      closeModal(actionTarget.dataset.close);
      if (actionTarget.dataset.close === "shipment-details-modal") {
        state.currentShipmentId = null;
      }
    }
    if (actionTarget.dataset.shipment) {
      openShipmentDetails(Number(actionTarget.dataset.shipment));
    }
    if (actionTarget.dataset.addLocation) {
      if (!isAdmin) return;
      openModal("location-modal");
    }
    if (actionTarget.dataset.addShipment) {
      if (!isAdmin) return;
      const locationId = Number(actionTarget.dataset.addShipment);
      const location = state.locations.find((item) => item.id === locationId);
      openShipmentModal(location?.name || null);
    }
    if (actionTarget.dataset.upload) {
      if (!isAdmin) return;
      openUpload(Number(actionTarget.dataset.upload));
    }
    if (actionTarget.dataset.records) {
      openRecords(Number(actionTarget.dataset.records));
    }
    if (actionTarget.dataset.exportLocation) {
      exportLocationExcel(Number(actionTarget.dataset.exportLocation));
    }
    if (actionTarget.dataset.refresh) {
      refreshShipment(Number(actionTarget.dataset.refresh));
    }
    if (actionTarget.dataset.delete) {
      if (!isAdmin) return;
      deleteShipment(Number(actionTarget.dataset.delete));
    }
    if (actionTarget.dataset.deleteLocation) {
      if (!isAdmin) return;
      deleteLocation(Number(actionTarget.dataset.deleteLocation));
    }
  });
}

async function init() {
  registerEvents();
  const isAuthed = document.body?.dataset?.authed === "true";
  if (!isAuthed) {
    window.location.href = "/";
    return;
  }
  try {
    await loadLocations();
    await loadShipments();
  } catch (err) {
    if (err.message !== "unauthorized") {
      console.error(err);
    }
  }
}

init();
