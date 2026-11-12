const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const toast = (message, error = false) => {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.className = "toast show" + (error ? " error" : "");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => el.className = "toast", 3000);
};
async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !location.pathname.includes("login")) location.href = "/login";
    throw new Error(data.error || "Не удалось выполнить запрос.");
  }
  return data;
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function openModal(id) { document.getElementById(id)?.classList.add("visible"); }
function closeModal(id) { document.getElementById(id)?.classList.remove("visible"); }
document.addEventListener("click", e => {
  const open = e.target.closest("[data-open]");
  const close = e.target.closest("[data-close]");
  if (open) openModal(open.dataset.open);
  if (close) closeModal(close.dataset.close);
  if (e.target.classList.contains("modal-backdrop")) e.target.classList.remove("visible");
});
$$("[data-logout]").forEach(button => button.addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); location.href = "/login"; }
  catch (e) { toast(e.message, true); }
}));

async function initShell() {
  if (location.pathname === "/login") return;
  try {
    const { user } = await api("/api/me");
    if (!user) { location.href = "/login"; return; }
    const initials = esc(user.name.slice(0, 1).toUpperCase());
    if ($("#sidebar-user")) $("#sidebar-user").innerHTML = `<div class="avatar">${initials}</div><div><strong>${esc(user.name)}</strong><small>${user.role === "admin" ? "Администратор" : "Сотрудник"}</small></div>`;
    if ($("#top-email")) $("#top-email").textContent = user.email;
    $$(".admin-only").forEach(el => el.classList.toggle("hidden", user.role !== "admin"));
    if ($("#welcome")) $("#welcome").textContent = `Добрый день, ${user.name.split(" ")[0]}!`;
    if ($("#role-name")) $("#role-name").textContent = user.role === "admin" ? "Администратор" : "Сотрудник";
    if ($("#today-date")) $("#today-date").textContent = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  } catch (e) {
    if (location.pathname !== "/login") location.href = "/login";
  }
}

$("#login-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  const error = $("#login-error");
  error.textContent = "";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
    location.href = "/";
  } catch (err) { error.textContent = err.message; }
});

async function loadUsers() {
  const users = await api("/api/users");
  const assigneeSelect = $("#task-assignee");
  const formSelect = $("#task-assignee-form");
  if (assigneeSelect) assigneeSelect.innerHTML = '<option value="">Все ответственные</option>' + users.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join("");
  if (formSelect) formSelect.innerHTML = users.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join("");
}
async function loadTasks() {
  const list = $("#task-list");
  if (!list) return;
  const params = new URLSearchParams();
  [["q","task-search"],["status","task-status"],["assignee","task-assignee"],["deadline","task-deadline"]].forEach(([key,id]) => {
    const value = document.getElementById(id)?.value?.trim();
    if (value) params.set(key, value);
  });
  try {
    const tasks = await api("/api/tasks?" + params.toString());
    list.innerHTML = tasks.length ? tasks.map(t => `
      <article class="task-row"><div class="task-main">
        <button class="task-check ${t.status === "Выполнена" ? "checked" : ""}" data-task-status="${t.id}" data-next-status="${t.status === "Выполнена" ? "Не выполнена" : "Выполнена"}" title="Изменить статус">${t.status === "Выполнена" ? "✓" : ""}</button>
        <div class="grow"><strong class="${t.status === "Выполнена" ? "completed-title" : ""}">${esc(t.title)}</strong><p>${esc(t.description || "Без описания")}</p><small>Постановщик: ${esc(t.creator)} · Ответственный: ${esc(t.assignee)}</small></div>
      </div><div class="task-meta"><span class="status ${t.status === "Выполнена" ? "done" : "pending"}">${esc(t.status)}</span><small>До ${new Date(t.deadline).toLocaleDateString("ru-RU")}</small></div></article>`).join("") : '<div class="empty">По заданным фильтрам задач нет.</div>';
  } catch (e) { list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
["task-search","task-status","task-assignee","task-deadline"].forEach(id => {
  document.getElementById(id)?.addEventListener(id === "task-search" ? "input" : "change", loadTasks);
});
$("#reset-filters")?.addEventListener("click", () => {
  ["task-search","task-status","task-assignee","task-deadline"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  loadTasks();
});
$("#task-list")?.addEventListener("click", async e => {
  const button = e.target.closest("[data-task-status]");
  if (!button) return;
  try { await api(`/api/tasks/${button.dataset.taskStatus}`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.nextStatus }) }); toast("Статус задачи обновлён."); loadTasks(); }
  catch (err) { toast(err.message, true); }
});
$("#task-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.currentTarget));
  try { await api("/api/tasks", { method: "POST", body: JSON.stringify(data) }); closeModal("task-modal"); e.currentTarget.reset(); toast("Задача создана."); loadTasks(); }
  catch (err) { toast(err.message, true); }
});

async function loadNews() {
  const feed = $("#news-feed");
  if (!feed) return;
  const items = await api("/api/news");
  const user = (await api("/api/me")).user;
  feed.innerHTML = items.length ? items.map(n => `<article class="panel news-card" id="news-${n.id}"><div class="news-card-top"><span class="news-tag">НОВОСТЬ</span><span class="muted">${new Date(n.created_at).toLocaleString("ru-RU")}</span></div><h2>${esc(n.title)}</h2><p class="news-body">${esc(n.body)}</p><div class="news-author"><div class="avatar small">${esc(n.author.slice(0,1).toUpperCase())}</div><span>${esc(n.author)}</span>${user.role === "admin" ? `<button class="danger-link" data-delete-news="${n.id}">Удалить</button>` : ""}</div></article>`).join("") : '<div class="panel empty">Публикаций пока нет. Создайте первую новость.</div>';
}
$("#news-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.currentTarget));
  try { await api("/api/news", { method: "POST", body: JSON.stringify(data) }); closeModal("news-modal"); e.currentTarget.reset(); toast("Новость опубликована."); loadNews(); }
  catch (err) { toast(err.message, true); }
});
$("#news-feed")?.addEventListener("click", async e => {
  const button = e.target.closest("[data-delete-news]");
  if (!button || !confirm("Удалить эту новость?")) return;
  try { await api(`/api/news/${button.dataset.deleteNews}`, { method: "DELETE" }); document.getElementById(`news-${button.dataset.deleteNews}`)?.remove(); toast("Новость удалена."); }
  catch (err) { toast(err.message, true); }
});

async function loadAdmin() {
  if (!$("#users-table")) return;
  const users = await api("/api/admin/users");
  $("#users-table").innerHTML = users.map(u => `<tr><td><div class="table-user"><div class="avatar small">${esc(u.name.slice(0,1).toUpperCase())}</div><div><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></div></div></td><td>${u.role === "admin" ? "Администратор" : "Сотрудник"}</td><td><span class="status ${u.is_blocked ? "blocked" : "done"}">${u.is_blocked ? "Заблокирован" : "Активен"}</span></td><td>${new Date(u.created_at).toLocaleDateString("ru-RU")}</td><td>${u.id !== window.currentUserId ? `<button class="danger-link" data-toggle-user="${u.id}">${u.is_blocked ? "Разблокировать" : "Заблокировать"}</button>` : ""}</td></tr>`).join("");
  const logs = await api("/api/admin/logs");
  $("#logs-list").innerHTML = logs.length ? logs.map(l => `<div class="log-row"><div class="log-icon">↗</div><div class="grow"><strong>${esc(l.action)}</strong><small>${esc(l.user_name)} · ${esc(l.details)}</small></div><time>${new Date(l.created_at).toLocaleString("ru-RU")}</time></div>`).join("") : '<div class="empty">Записей пока нет.</div>';
}
$("#users-table")?.addEventListener("click", async e => {
  const button = e.target.closest("[data-toggle-user]");
  if (!button || !confirm("Изменить статус блокировки пользователя?")) return;
  try { await api(`/api/admin/users/${button.dataset.toggleUser}`, { method: "PATCH", body: "{}" }); toast("Статус пользователя изменён."); loadAdmin(); }
  catch (err) { toast(err.message, true); }
});
$("#user-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.currentTarget));
  try { await api("/api/admin/users", { method: "POST", body: JSON.stringify(data) }); closeModal("user-modal"); e.currentTarget.reset(); toast("Пользователь создан."); loadAdmin(); }
  catch (err) { toast(err.message, true); }
});

async function loadHome() {
  if (!$("#home-tasks")) return;
  const [tasks, news] = await Promise.all([api("/api/tasks"), api("/api/news")]);
  $("#task-count").textContent = tasks.length;
  $("#news-count").textContent = news.length;
  $("#home-tasks").innerHTML = tasks.slice(0,5).map(t => `<div class="compact-row"><div class="task-dot"></div><div class="grow"><strong>${esc(t.title)}</strong><small>Ответственный: ${esc(t.assignee)}</small></div><span class="status ${t.status === "Выполнена" ? "done" : "pending"}">${esc(t.status)}</span></div>`).join("") || '<div class="empty">Пока задач нет.</div>';
  $("#home-news").innerHTML = news.slice(0,5).map(n => `<div class="news-preview"><div class="news-date">${new Date(n.created_at).toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit"})}</div><div><strong>${esc(n.title)}</strong><p>${esc(n.body.slice(0,95))}</p></div></div>`).join("") || '<div class="empty">Новостей пока нет.</div>';
}

(async function boot() {
  if (location.pathname === "/login") return;
  try {
    const { user } = await api("/api/me");
    if (!user) { location.href = "/login"; return; }
    window.currentUserId = user.id;
    const initials = esc(user.name.slice(0,1).toUpperCase());
    if ($("#sidebar-user")) $("#sidebar-user").innerHTML = `<div class="avatar">${initials}</div><div><strong>${esc(user.name)}</strong><small>${user.role === "admin" ? "Администратор" : "Сотрудник"}</small></div>`;
    if ($("#top-email")) $("#top-email").textContent = user.email;
    $$(".admin-only").forEach(el => el.classList.toggle("hidden", user.role !== "admin"));
    if ($("#welcome")) $("#welcome").textContent = `Добрый день, ${user.name.split(" ")[0]}!`;
    if ($("#role-name")) $("#role-name").textContent = user.role === "admin" ? "Администратор" : "Сотрудник";
    if ($("#today-date")) $("#today-date").textContent = new Intl.DateTimeFormat("ru-RU", {day:"numeric",month:"long",year:"numeric"}).format(new Date());
    if ($("#task-list")) { await loadUsers(); await loadTasks(); }
    if ($("#news-feed")) await loadNews();
    if ($("#users-table")) await loadAdmin();
    if ($("#home-tasks")) await loadHome();
  } catch (e) {
    if (location.pathname !== "/login") location.href = "/login";
  }
})();
