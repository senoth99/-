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
  const error = qs("avatar-error");
  if (error) {
    error.textContent = message;
  }
}

function renderProfile(profile) {
  const avatar = qs("profile-avatar");
  const name = qs("profile-name");
  const role = qs("profile-role");
  const xp = qs("profile-xp");
  if (name) name.textContent = profile.name;
  if (role) role.textContent = profile.role === "admin" ? "Админ" : "Сотрудник";
  if (xp) xp.textContent = `XP: ${profile.xp || 0}`;
  if (avatar) {
    if (profile.avatar_url) {
      avatar.innerHTML = `<img src="${profile.avatar_url}" alt="${profile.name}" />`;
    } else {
      avatar.textContent = profile.name?.slice(0, 1).toUpperCase() || "П";
    }
  }
  const avatarInput = qs("avatar-url");
  if (avatarInput) {
    avatarInput.value = profile.avatar_url || "";
  }
}

function renderBadges(badges) {
  const container = qs("profile-badges");
  if (!container) return;
  container.innerHTML = "";
  if (!badges.length) {
    container.innerHTML = "<p class='subtitle'>Пока нет бейджей за курсы.</p>";
    return;
  }
  badges.forEach((badge) => {
    const card = document.createElement("div");
    card.className = "profile-badge";
    card.innerHTML = `
      <div class="profile-badge-icon">🏅</div>
      <div>
        <strong>${badge.badge_label}</strong>
        <p class="subtitle">${badge.course_title || "Курс"}</p>
      </div>
      <span class="profile-badge-xp">+${badge.xp_awarded || 0} XP</span>
    `;
    container.appendChild(card);
  });
}

async function loadProfile() {
  const data = await api("/api/profile");
  renderProfile(data.profile);
  renderBadges(data.badges || []);
}

async function handleAvatarSave() {
  const avatarUrl = qs("avatar-url")?.value.trim();
  setError();
  try {
    await api("/api/profile/avatar", {
      method: "POST",
      body: JSON.stringify({ avatar_url: avatarUrl }),
    });
    await loadProfile();
  } catch (err) {
    setError(err.message);
  }
}

function init() {
  loadProfile().catch((err) => setError(err.message));
  qs("avatar-save")?.addEventListener("click", handleAvatarSave);
}

init();
