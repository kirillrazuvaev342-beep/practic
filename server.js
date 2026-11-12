require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const { pool } = require("./database");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: "portal.sid",
  secret: process.env.SESSION_SECRET || "development-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

app.use("/assets", express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Необходимо войти в систему." });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Недостаточно прав." });
  }
  next();
}
function logAction(userId, action, details) {
  return pool.execute(
    "INSERT INTO activity_logs (user_id, action, details) VALUES (?,?,?)",
    [userId, action, String(details).slice(0, 255)]
  );
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", req.session.user ? "index.html" : "login.html"));
});
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});
app.get("/tasks", requireAuth, (_req, res) => res.sendFile(path.join(__dirname, "public", "tasks.html")));
app.get("/news", requireAuth, (_req, res) => res.sendFile(path.join(__dirname, "public", "news.html")));
app.get("/admin", requireAdmin, (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.get("/api/me", (req, res) => res.json({ user: req.session.user || null }));

app.post("/api/login", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!validEmail(email) || !password) return res.status(400).json({ error: "Введите корректный email и пароль." });

    const [rows] = await pool.execute(
      "SELECT id,name,email,password_hash,role,is_blocked FROM users WHERE email=? LIMIT 1",
      [email]
    );
    const user = rows[0];
    if (!user || user.is_blocked || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Неверная почта или пароль, либо аккаунт заблокирован." });
    }

    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
      req.session.save(saveErr => {
        if (saveErr) return next(saveErr);
        res.json({ message: "Вход выполнен.", user: req.session.user });
      });
    });
  } catch (err) { next(err); }
});

app.post("/api/logout", requireAuth, (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie("portal.sid");
    res.json({ message: "Вы вышли из системы." });
  });
});

app.get("/api/tasks", requireAuth, async (req, res, next) => {
  try {
    const where = [];
    const values = [];
    if (["Не выполнена", "Выполнена"].includes(req.query.status)) {
      where.push("t.status=?"); values.push(req.query.status);
    }
    if (req.query.assignee && /^\d+$/.test(req.query.assignee)) {
      where.push("t.assignee_id=?"); values.push(Number(req.query.assignee));
    }
    if (req.query.deadline) {
      if (!validDate(req.query.deadline)) return res.status(400).json({ error: "Неверный формат даты." });
      where.push("t.deadline=?"); values.push(req.query.deadline);
    }
    if (req.query.q) {
      where.push("t.title LIKE ?"); values.push(`%${String(req.query.q).slice(0, 100)}%`);
    }
    const sql = `
      SELECT t.id,t.title,t.description,t.deadline,t.status,t.creator_id,t.assignee_id,
             creator.name AS creator, assignee.name AS assignee
      FROM tasks t
      JOIN users creator ON creator.id=t.creator_id
      JOIN users assignee ON assignee.id=t.assignee_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY t.deadline ASC`;
    const [tasks] = await pool.execute(sql, values);
    res.json(tasks.map(t => ({ ...t, can_edit: req.session.user.role === "admin" || t.creator_id === req.session.user.id })));
  } catch (err) { next(err); }
});

app.get("/api/users", requireAuth, async (_req, res, next) => {
  try {
    const [users] = await pool.execute(
      "SELECT id,name,email,role,is_blocked,created_at FROM users WHERE is_blocked=FALSE ORDER BY name"
    );
    res.json(users);
  } catch (err) { next(err); }
});

app.post("/api/tasks", requireAuth, async (req, res, next) => {
  try {
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    const assigneeId = Number(req.body.assignee_id);
    const deadline = String(req.body.deadline || "");
    if (!title || title.length > 160 || !validDate(deadline) || !Number.isInteger(assigneeId)) {
      return res.status(400).json({ error: "Укажите название, корректный срок и ответственного." });
    }
    const [users] = await pool.execute("SELECT id FROM users WHERE id=? AND is_blocked=FALSE", [assigneeId]);
    if (!users.length) return res.status(400).json({ error: "Ответственный не найден." });

    const [result] = await pool.execute(
      "INSERT INTO tasks (title,description,creator_id,assignee_id,deadline) VALUES (?,?,?,?,?)",
      [title, description, req.session.user.id, assigneeId, deadline]
    );
    await logAction(req.session.user.id, "Создание задачи", `Создана задача «${title}»`);
    res.status(201).json({ message: "Задача создана.", id: result.insertId });
  } catch (err) { next(err); }
});

app.patch("/api/tasks/:id", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.execute("SELECT * FROM tasks WHERE id=?", [id]);
    const task = rows[0];
    if (!task) return res.status(404).json({ error: "Задача не найдена." });

    const data = req.body || {};
    if (Object.hasOwn(data, "status")) {
      if (!["Не выполнена", "Выполнена"].includes(data.status)) {
        return res.status(400).json({ error: "Недопустимый статус." });
      }
      await pool.execute("UPDATE tasks SET status=? WHERE id=?", [data.status, id]);
      await logAction(req.session.user.id, "Изменение статуса", `Задача «${task.title}»: ${data.status}`);
    }

    const editFields = ["title", "description", "deadline", "assignee_id"];
    const wantsEdit = editFields.some(key => Object.hasOwn(data, key));
    if (wantsEdit) {
      if (req.session.user.role !== "admin" && task.creator_id !== req.session.user.id) {
        return res.status(403).json({ error: "Редактировать задачу может её постановщик или администратор." });
      }
      const title = Object.hasOwn(data, "title") ? String(data.title).trim() : task.title;
      const description = Object.hasOwn(data, "description") ? String(data.description).trim() : task.description;
      const deadline = Object.hasOwn(data, "deadline") ? String(data.deadline) : task.deadline.toISOString?.().slice(0,10) || task.deadline;
      const assigneeId = Object.hasOwn(data, "assignee_id") ? Number(data.assignee_id) : task.assignee_id;
      if (!title || title.length > 160 || !validDate(deadline) || !Number.isInteger(assigneeId)) {
        return res.status(400).json({ error: "Проверьте название, дату и ответственного." });
      }
      const [assignees] = await pool.execute("SELECT id FROM users WHERE id=? AND is_blocked=FALSE", [assigneeId]);
      if (!assignees.length) return res.status(400).json({ error: "Ответственный не найден." });
      await pool.execute(
        "UPDATE tasks SET title=?,description=?,deadline=?,assignee_id=? WHERE id=?",
        [title, description, deadline, assigneeId, id]
      );
      await logAction(req.session.user.id, "Редактирование задачи", `Изменена задача «${title}»`);
    }
    res.json({ message: "Изменения сохранены." });
  } catch (err) { next(err); }
});

app.get("/api/news", requireAuth, async (_req, res, next) => {
  try {
    const [items] = await pool.execute(`
      SELECT n.id,n.title,n.body,n.created_at,u.name AS author
      FROM news n JOIN users u ON u.id=n.author_id
      ORDER BY n.created_at DESC`);
    res.json(items);
  } catch (err) { next(err); }
});

app.post("/api/news", requireAuth, async (req, res, next) => {
  try {
    const title = String(req.body.title || "").trim();
    const body = String(req.body.body || "").trim();
    if (!title || title.length > 160 || !body) {
      return res.status(400).json({ error: "Заполните заголовок (до 160 символов) и текст новости." });
    }
    const [result] = await pool.execute(
      "INSERT INTO news (title,body,author_id) VALUES (?,?,?)",
      [title, body, req.session.user.id]
    );
    await logAction(req.session.user.id, "Создание новости", `Опубликована новость «${title}»`);
    res.status(201).json({ message: "Новость опубликована.", id: result.insertId });
  } catch (err) { next(err); }
});

app.delete("/api/news/:id", requireAdmin, async (req, res, next) => {
  try {
    const [rows] = await pool.execute("SELECT title FROM news WHERE id=?", [Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: "Новость не найдена." });
    await pool.execute("DELETE FROM news WHERE id=?", [Number(req.params.id)]);
    await logAction(req.session.user.id, "Удаление новости", `Удалена новость «${rows[0].title}»`);
    res.json({ message: "Новость удалена." });
  } catch (err) { next(err); }
});

app.get("/api/admin/users", requireAdmin, async (_req, res, next) => {
  try {
    const [users] = await pool.execute(
      "SELECT id,name,email,role,is_blocked,created_at FROM users ORDER BY created_at DESC"
    );
    res.json(users);
  } catch (err) { next(err); }
});

app.post("/api/admin/users", requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const role = req.body.role || "employee";
    if (!name || name.length > 100 || !validEmail(email) || password.length < 8 || !["admin", "employee"].includes(role)) {
      return res.status(400).json({ error: "Проверьте имя, email, роль и пароль (минимум 8 символов)." });
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.execute(
      "INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)",
      [name, email, hash, role]
    );
    await logAction(req.session.user.id, "Создание пользователя", `Создан пользователь ${email}`);
    res.status(201).json({ message: "Пользователь создан." });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Пользователь с таким email уже существует." });
    next(err);
  }
});

app.patch("/api/admin/users/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.session.user.id) return res.status(400).json({ error: "Нельзя заблокировать собственный аккаунт." });
    const [rows] = await pool.execute("SELECT id,email,is_blocked FROM users WHERE id=?", [id]);
    if (!rows.length) return res.status(404).json({ error: "Пользователь не найден." });
    const blocked = !Boolean(rows[0].is_blocked);
    await pool.execute("UPDATE users SET is_blocked=? WHERE id=?", [blocked, id]);
    await logAction(req.session.user.id, "Изменение пользователя", `${rows[0].email}: ${blocked ? "заблокирован" : "разблокирован"}`);
    res.json({ message: "Статус пользователя изменён.", is_blocked: blocked });
  } catch (err) { next(err); }
});

app.get("/api/admin/logs", requireAdmin, async (_req, res, next) => {
  try {
    const [logs] = await pool.execute(`
      SELECT l.id,l.action,l.details,l.created_at,u.name AS user_name
      FROM activity_logs l JOIN users u ON u.id=l.user_id
      ORDER BY l.created_at DESC LIMIT 50`);
    res.json(logs);
  } catch (err) { next(err); }
});

app.use((err, _req, res, _next) => {
  console.error("[server error]", err);
  if (err.code === "ER_NO_SUCH_TABLE" || err.code === "ECONNREFUSED") {
    return res.status(500).json({ error: "Не удалось подключиться к базе данных. Проверьте MySQL и настройки .env." });
  }
  res.status(500).json({ error: "Внутренняя ошибка сервера." });
});

app.listen(PORT, () => {
  console.log(`Портал запущен: http://localhost:${PORT}`);
});
