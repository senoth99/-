const THEME_STORAGE_KEY = "crm-theme";
const DARK_CLASS = "theme-dark";

const applyTheme = (theme) => {
  const isDark = theme === "dark";
  document.body.classList.toggle(DARK_CLASS, isDark);
  document.body.dataset.theme = theme;
  const toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(isDark));
    toggle.textContent = isDark ? "Ночной режим: вкл" : "Ночной режим: выкл";
  }
};

const initTheme = () => {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const theme = storedTheme === "dark" ? "dark" : "light";
  applyTheme(theme);
};

const toggleTheme = () => {
  const isDark = document.body.classList.contains(DARK_CLASS);
  const nextTheme = isDark ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  applyTheme(nextTheme);
};

initTheme();

const themeToggle = document.getElementById("theme-toggle");
themeToggle?.addEventListener("click", toggleTheme);
