const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'pulseboard.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 60),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 120),
    description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 500),
    status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
    due_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tasks_status_updated ON tasks(status, updated_at DESC);
`);

const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
if (userCount === 0) {
  const demo = db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)')
    .run('Alex Morgan', 'demo@pulseboard.app', bcrypt.hashSync('Classroom2026!', 10));
  const insert = db.prepare(`INSERT INTO tasks(user_id,title,description,status,priority,due_date)
    VALUES(@user_id,@title,@description,@status,@priority,@due_date)`);
  const seed = [
    { title: 'Prepare the lab worksheet', description: 'Add the circuit diagrams and upload the answer key.', status: 'todo', priority: 'high', due_date: null },
    { title: 'Review chapter 04 notes', description: 'Focus on event loops and asynchronous communication.', status: 'doing', priority: 'normal', due_date: null },
    { title: 'Submit weekly reflection', description: 'Share one learning and one open question with the class.', status: 'done', priority: 'low', due_date: null }
  ];
  const transaction = db.transaction(() => seed.forEach(task => insert.run({ ...task, user_id: demo.lastInsertRowid })));
  transaction();
}

module.exports = { db };
