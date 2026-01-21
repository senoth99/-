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

const formatCurrency = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (Number.isNaN(number)) return String(value);
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(number);
};

const formatPerson = (person) => {
  if (!person) return null;
  const parts = [person.name, person.company, person.phone]
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
};

const resolveAddress = (location, detail) => {
  const detailAddress =
    detail?.address?.address ||
    detail?.address?.full_address ||
    detail?.address_full ||
    detail?.address_string ||
    detail?.address;
  if (typeof detailAddress === "string" && detailAddress.trim()) {
    return detailAddress.trim();
  }
  const locationAddress =
    location?.address || location?.address_full || location?.address_string;
  const parts = [location?.city, locationAddress].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
};

const statusIconMap = {
  DELIVERED: "📦",
  DELIVERED_TO_RECIPIENT: "📦",
  DELIVERED_TO_CLIENT: "📦",
  DELIVERED_TO_DOOR: "📦",
  DELIVERED_TO_PVZ: "📦",
  DELIVERED_TO_POSTOMAT: "📦",
  READY_FOR_PICKUP: "🏬",
  ARRIVED_AT_PVZ: "🏬",
  READY_TO_PICKUP: "🏬",
  READY_TO_RECEIVE: "🏬",
  IN_TRANSIT: "🚚",
  TRANSIT: "🚚",
  ON_THE_WAY: "🚚",
  ACCEPTED: "🕒",
  RECEIVED: "🕒",
  TAKEN: "🕒",
  CREATED: "📝",
  PENDING_REGISTRATION: "⏳",
  UNKNOWN: "❔",
};

const resolveStatusIcon = (shipment) => {
  const code = (shipment.cdek_state || "").toUpperCase();
  if (statusIconMap[code]) {
    return statusIconMap[code];
  }
  const statusText = (shipment.last_status || "").toLowerCase();
  if (
    statusText.includes("вручен") ||
    statusText.includes("вручён") ||
    statusText.includes("доставлен")
  ) {
    return "📦";
  }
  if (
    statusText.includes("выдан") ||
    statusText.includes("готов") ||
    statusText.includes("ожидает получения")
  ) {
    return "🏬";
  }
  if (statusText.includes("принят")) {
    return "🕒";
  }
  if (statusText.includes("создан")) {
    return "📝";
  }
  if (statusText.includes("ожидает регистрации")) {
    return "⏳";
  }
  if (
    statusText.includes("в пути") ||
    statusText.includes("отправлен") ||
    statusText.includes("отгруж")
  ) {
    return "🚚";
  }
  return "🚚";
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
  if (!state.locations.length) {
    grid.innerHTML =
      "<div class='card'>Нет точек продаж. Добавьте первую точку.</div>";
    return;
  }
  state.locations.forEach((location) => {
    const card = document.createElement("div");
    card.className = "card animated-card";
    const actions = isAdmin
      ? `
      <div class="card-actions">
        <button class="secondary" data-upload="${location.id}">Импорт</button>
        <button class="light" data-records="${location.id}">Детали</button>
        <button class="light danger" data-delete-location="${location.id}">
          Удалить
        </button>
      </div>
    `
      : `
      <div class="card-actions">
        <button class="secondary" data-records="${location.id}">Детали</button>
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
        <button class="icon-btn success" data-refresh="${shipment.id}" aria-label="Обновить">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M20 12a8 8 0 1 1-2.34-5.66"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
            <path
              d="M20 6v6h-6"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button class="icon-btn danger" data-delete="${shipment.id}" aria-label="Удалить">×</button>
      `
      : "";
    card.innerHTML = `
      <div class="shipment-header">
        <div>
          <h3>${shipment.display_number || shipment.internal_number || "-"}</h3>
          <div class="shipment-route">${shipment.origin_label} → ${shipment.destination_label}</div>
        </div>
        <div class="shipment-actions">
          ${actionButtons}
        </div>
      </div>
      <div class="shipment-status">${shipment.last_status || "Нет данных"}</div>
      <div class="meta">${shipment.last_location || "Локация неизвестна"}</div>
      <div class="meta">${formatDate(shipment.last_update)}</div>
      <div class="shipment-truck">${resolveStatusIcon(shipment)}</div>
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
    item.innerHTML = `
      <strong>${status.name || status.code || "Статус"}</strong>
      <span class="meta">${status.city || "Локация неизвестна"}</span>
      <span class="meta">${formatDate(status.date_time)}</span>
    `;
    container.appendChild(item);
  });
}

async function openShipmentDetails(shipmentId) {
  const shipment = state.shipments.find((item) => item.id === shipmentId);
  if (!shipment) return;
  state.currentShipmentId = shipmentId;
  const title = qs("shipment-detail-title");
  const route = qs("shipment-detail-route");
  const refreshBtn = qs("shipment-detail-refresh");
  const deleteBtn = qs("shipment-detail-delete");
  const cdekLink = qs("shipment-cdek-link");
  const mainContainer = qs("shipment-detail-main");
  const extraContainer = qs("shipment-detail-extra");
  const statusesContainer = qs("shipment-detail-statuses");
  const trackNumber = shipment.display_number || shipment.internal_number || "";

  title.textContent = `Поставка ${trackNumber || shipment.id}`;
  route.textContent = `${shipment.origin_label} → ${shipment.destination_label}`;
  refreshBtn.dataset.refresh = shipment.id;
  deleteBtn.dataset.delete = shipment.id;
  cdekLink.href = trackNumber
    ? `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(trackNumber)}`
    : "https://www.cdek.ru/ru/tracking";

  mainContainer.innerHTML =
    "<div class='detail-item'><span class='detail-label'>Загрузка...</span></div>";
  extraContainer.innerHTML =
    "<div class='detail-item'><span class='detail-label'>Загрузка...</span></div>";
  statusesContainer.innerHTML =
    "<div class='status-item'>Загрузка статусов...</div>";
  openModal("shipment-details-modal");

  if (!trackNumber) {
    renderDetailItems(mainContainer, [
      { label: "Статус", value: shipment.last_status || "Нет данных" },
      { label: "Последнее обновление", value: formatDate(shipment.last_update) },
      { label: "Локация", value: shipment.last_location || "Локация неизвестна" },
    ]);
    renderDetailItems(extraContainer, [
      { label: "Получатель", value: "Нет трек-номера" },
    ]);
    renderStatusHistory(statusesContainer, []);
    return;
  }

  try {
    const tracking = await api("/api/track", {
      method: "POST",
      body: JSON.stringify({ track_number: trackNumber }),
    });
    const order = tracking.order || {};
    const recipient = order.recipient || {};
    const sender = order.sender || {};
    const deliveryDetail = order.delivery_detail || {};
    const fromLocation = order.from_location || {};
    const toLocation = order.to_location || {};
    const deliveryPoint = deliveryDetail.delivery_point || deliveryDetail.point;

    renderDetailItems(mainContainer, [
      {
        label: "Статус",
        value:
          tracking.status?.name ||
          tracking.status?.code ||
          shipment.last_status ||
          "Нет данных",
      },
      {
        label: "Последнее обновление",
        value: formatDate(tracking.status?.date_time || shipment.last_update),
      },
      {
        label: "Текущая локация",
        value:
          tracking.status?.city || shipment.last_location || "Локация неизвестна",
      },
      {
        label: "Откуда",
        value: fromLocation.city || shipment.origin_label,
      },
      {
        label: "Куда",
        value: toLocation.city || shipment.destination_label,
      },
      {
        label: "Адрес отправки",
        value: resolveAddress(fromLocation) || shipment.origin_label,
      },
      {
        label: "Адрес доставки",
        value: resolveAddress(toLocation, deliveryDetail) || shipment.destination_label,
      },
      {
        label: "Пункт выдачи",
        value: deliveryPoint ? `ПВЗ ${deliveryPoint}` : null,
      },
    ]);

    renderDetailItems(extraContainer, [
      { label: "Получатель", value: formatPerson(recipient) || recipient.name },
      { label: "Email получателя", value: recipient.email },
      { label: "Отправитель", value: formatPerson(sender) || sender.name },
      {
        label: "Стоимость доставки",
        value: formatCurrency(order.delivery_sum),
      },
      { label: "Стоимость заказа", value: formatCurrency(order.total_sum) },
      {
        label: "Плановая доставка",
        value: formatDate(order.planned_delivery_date),
      },
      { label: "Комментарий", value: order.comment },
    ]);

    renderStatusHistory(statusesContainer, tracking.statuses);
  } catch (err) {
    renderDetailItems(mainContainer, [
      { label: "Ошибка", value: err.message },
    ]);
    renderDetailItems(extraContainer, [
      { label: "Получатель", value: "Нет данных" },
    ]);
    renderStatusHistory(statusesContainer, []);
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

function openShipmentModal() {
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

async function exportExcel() {
  const response = await fetch("/api/export");
  if (!response.ok) {
    showNotification("Ошибка экспорта.", "error");
    return;
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "crm_export.xlsx";
  link.click();
  window.URL.revokeObjectURL(url);
  showNotification("Экспорт Excel начался.", "info");
}

async function refreshShipment(shipmentId) {
  try {
    await api(`/api/shipments/${shipmentId}/refresh`, { method: "POST" });
    await loadShipments();
    if (state.currentShipmentId === shipmentId) {
      await openShipmentDetails(shipmentId);
    }
    showNotification("Статус поставки обновлен.", "success");
  } catch (err) {
    showNotification(err.message, "error");
  }
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
    qs("add-location-btn")?.addEventListener("click", () =>
      openModal("location-modal"),
    );
    qs("add-shipment-btn")?.addEventListener("click", openShipmentModal);
  }
  qs("export-btn").addEventListener("click", exportExcel);
  if (isAdmin) {
    qs("location-save").addEventListener("click", handleAddLocation);
    qs("shipment-save").addEventListener("click", handleAddShipment);
    qs("upload-submit").addEventListener("click", submitUpload);
  }
  qs("logout-btn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    window.location.href = "/login";
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    const actionTarget = target.closest(
      "[data-close],[data-upload],[data-records],[data-refresh],[data-delete],[data-delete-location],[data-shipment]",
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
    if (actionTarget.dataset.upload) {
      if (!isAdmin) return;
      openUpload(Number(actionTarget.dataset.upload));
    }
    if (actionTarget.dataset.records) {
      openRecords(Number(actionTarget.dataset.records));
    }
    if (actionTarget.dataset.refresh) {
      if (!isAdmin) return;
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
