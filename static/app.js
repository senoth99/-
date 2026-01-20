const state = {
  locations: [],
  currentLocationId: null,
};

const modal = (id) => document.getElementById(id);
const qs = (id) => document.getElementById(id);

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

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (response.status === 401) {
    openModal("login-modal");
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
    card.className = "card";
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
      <div class="card-actions">
        <button class="secondary" data-upload="${location.id}">Импорт</button>
        <button class="light" data-records="${location.id}">Детали</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

async function handleLogin() {
  const password = qs("login-password").value.trim();
  const error = qs("login-error");
  error.textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    closeModal("login-modal");
    await loadLocations();
  } catch (err) {
    error.textContent = err.message;
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
  } catch (err) {
    error.textContent = err.message;
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
  } catch (err) {
    error.textContent = err.message;
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
    alert("Ошибка экспорта");
    return;
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "crm_export.xlsx";
  link.click();
  window.URL.revokeObjectURL(url);
}

function registerEvents() {
  qs("add-location-btn").addEventListener("click", () => openModal("location-modal"));
  qs("export-btn").addEventListener("click", exportExcel);
  qs("login-submit").addEventListener("click", handleLogin);
  qs("location-save").addEventListener("click", handleAddLocation);
  qs("upload-submit").addEventListener("click", submitUpload);
  qs("logout-btn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    openModal("login-modal");
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target.dataset.close) {
      closeModal(target.dataset.close);
    }
    if (target.dataset.upload) {
      openUpload(Number(target.dataset.upload));
    }
    if (target.dataset.records) {
      openRecords(Number(target.dataset.records));
    }
  });
}

async function init() {
  registerEvents();
  try {
    await loadLocations();
  } catch (err) {
    if (err.message !== "unauthorized") {
      console.error(err);
    }
  }
}

init();
