require("dotenv").config();
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const config = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "portal_user",
  password: process.env.DB_PASSWORD || "portal_password",
  database: process.env.DB_NAME || "company_portal",
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4"
};

const pool = mysql.createPool(config);

async function initDatabase() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(120) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('admin','employee') NOT NULL DEFAULT 'employee',
        is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(160) NOT NULL,
        description TEXT,
        creator_id INT NOT NULL,
        assignee_id INT NOT NULL,
        deadline DATE NOT NULL,
        status ENUM('Не выполнена','Выполнена') NOT NULL DEFAULT 'Не выполнена',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_task_creator FOREIGN KEY (creator_id) REFERENCES users(id),
        CONSTRAINT fk_task_assignee FOREIGN KEY (assignee_id) REFERENCES users(id),
        INDEX idx_task_status (status),
        INDEX idx_task_deadline (deadline)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS news (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(160) NOT NULL,
        body TEXT NOT NULL,
        author_id INT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_news_author FOREIGN KEY (author_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        action VARCHAR(100) NOT NULL,
        details VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_log_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [existing] = await connection.query("SELECT COUNT(*) AS total FROM users");
    if (existing[0].total === 0) {
      const adminHash = await bcrypt.hash("Admin123!", 12);
      const userHash = await bcrypt.hash("User12345!", 12);

      const [adminResult] = await connection.execute(
        "INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')",
        ["Администратор", "admin@example.com", adminHash]
      );
      const [userResult] = await connection.execute(
        "INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'employee')",
        ["Иван Сотрудник", "user@example.com", userHash]
      );

      const adminId = adminResult.insertId;
      const userId = userResult.insertId;
      const tasks = [
        ["Подготовить еженедельный отчёт", "Собрать показатели отдела.", adminId, userId, datePlus(2)],
        ["Обновить контакты команды", "Проверить список сотрудников.", userId, userId, datePlus(4)],
        ["Подготовить материалы встречи", "Сформировать повестку.", adminId, adminId, datePlus(6)]
      ];
      for (const task of tasks) {
        await connection.execute(
          "INSERT INTO tasks (title,description,creator_id,assignee_id,deadline) VALUES (?,?,?,?,?)",
          task
        );
      }

      const news = [
        ["Добро пожаловать на портал", "Здесь собраны новости компании и рабочие задачи.", adminId],
        ["Планёрка команды", "На этой неделе планёрка состоится в пятницу в 10:00.", userId],
        ["Обновление рабочих процессов", "Пожалуйста, проверяйте сроки и статусы своих задач.", adminId]
      ];
      for (const item of news) {
        await connection.execute(
          "INSERT INTO news (title,body,author_id) VALUES (?,?,?)",
          item
        );
      }
      console.log("Добавлены демонстрационные пользователи, задачи и новости.");
    } else {
      console.log("Таблицы готовы. Данные пользователей уже существуют — сиды не добавлялись.");
    }
    console.log("Инициализация базы данных завершена.");
  } finally {
    connection.release();
    await pool.end();
  }
}

function datePlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

if (require.main === module) {
  if (process.argv.includes("--init")) {
    initDatabase().catch(err => {
      console.error("Ошибка инициализации БД:", err.message);
      process.exit(1);
    });
  } else {
    console.log("Для создания таблиц выполните: npm run init-db");
    pool.end();
  }
}

module.exports = { pool };
