const http = require('node:http');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { db } = require('./src/database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me-please';
const TOKEN_TTL = '8h';

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://cdn.socket.io'], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], connectSrc: ["'self'", 'ws:', 'wss:'], imgSrc: ["'self'", 'data:'] } } }));
app.use(express.json({ limit: '32kb' }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Please try again later.' } } });

function fail(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}
function tokenFor(user) { return jwt.sign({ sub: String(user.id), name: user.name }, JWT_SECRET, { expiresIn: TOKEN_TTL }); }
function publicUser(user) { return { id: user.id, name: user.name, email: user.email }; }
function auth(req, res, next) {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return fail(res, 401, 'AUTH_REQUIRED', 'Sign in to continue.');
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.user = { id: Number(payload.sub), name: payload.name };
    next();
  } catch {
    return fail(res, 401, 'INVALID_TOKEN', 'Your session is invalid or expired. Sign in again.');
  }
}
function validString(value, min, max) { return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max; }
function taskFromRow(row) {
  return { id: row.id, title: row.title, description: row.description, status: row.status, priority: row.priority, dueDate: row.due_date, createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.creator_name || 'Class member', creatorId: row.user_id };
}
function getTask(taskId) { return db.prepare('SELECT t.*, u.name AS creator_name FROM tasks t LEFT JOIN users u ON u.id=t.user_id WHERE t.id=?').get(taskId); }
function parseId(value) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; }

app.get('/api/health', (req, res) => res.json({ success: true, data: { status: 'ok', database: db.prepare('SELECT 1 AS ok').get().ok === 1, timestamp: new Date().toISOString() } }));
app.post('/api/auth/register', authLimiter, (req, res, next) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body.password;
    if (!validString(name, 2, 60)) return fail(res, 400, 'VALIDATION_ERROR', 'Name must be 2–60 characters.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return fail(res, 400, 'VALIDATION_ERROR', 'Enter a valid email address.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) return fail(res, 400, 'VALIDATION_ERROR', 'Password must be 8–72 characters.');
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return fail(res, 409, 'EMAIL_EXISTS', 'An account with that email already exists.');
    const result = db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name, email, bcrypt.hashSync(password, 10));
    const user = db.prepare('SELECT id,name,email FROM users WHERE id=?').get(result.lastInsertRowid);
    return res.status(201).json({ success: true, data: { user: publicUser(user), token: tokenFor(user) } });
  } catch (err) { next(err); }
});
app.post('/api/auth/login', authLimiter, (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || typeof password !== 'string' || !bcrypt.compareSync(password, user.password_hash)) return fail(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  return res.json({ success: true, data: { user: publicUser(user), token: tokenFor(user) } });
});
app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT id,name,email FROM users WHERE id=?').get(req.user.id);
  if (!user) return fail(res, 401, 'USER_NOT_FOUND', 'This account no longer exists.');
  return res.json({ success: true, data: { user: publicUser(user) } });
});

app.get('/api/tasks', auth, (req, res) => {
  const { status, q } = req.query;
  if (status && !['todo', 'doing', 'done'].includes(status)) return fail(res, 400, 'VALIDATION_ERROR', 'Status must be todo, doing, or done.');
  if (q !== undefined && (typeof q !== 'string' || q.length > 100)) return fail(res, 400, 'VALIDATION_ERROR', 'Search text must be at most 100 characters.');
  let sql = 'SELECT t.*, u.name AS creator_name FROM tasks t LEFT JOIN users u ON u.id=t.user_id WHERE 1=1';
  const args = [];
  if (status) { sql += ' AND t.status=?'; args.push(status); }
  if (q) { sql += ' AND (t.title LIKE ? OR t.description LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY CASE t.status WHEN \'todo\' THEN 1 WHEN \'doing\' THEN 2 ELSE 3 END, t.updated_at DESC, t.id DESC';
  return res.json({ success: true, data: { tasks: db.prepare(sql).all(...args).map(taskFromRow), count: db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count } });
});
app.post('/api/tasks', auth, (req, res) => {
  const { title, description = '', status = 'todo', priority = 'normal', dueDate = null } = req.body;
  if (!validString(title, 3, 120)) return fail(res, 400, 'VALIDATION_ERROR', 'Title must be 3–120 characters.');
  if (typeof description !== 'string' || description.length > 500) return fail(res, 400, 'VALIDATION_ERROR', 'Description must be at most 500 characters.');
  if (!['todo', 'doing', 'done'].includes(status) || !['low', 'normal', 'high'].includes(priority)) return fail(res, 400, 'VALIDATION_ERROR', 'Choose a valid status and priority.');
  if (dueDate !== null && (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) return fail(res, 400, 'VALIDATION_ERROR', 'Due date must use YYYY-MM-DD.');
  const result = db.prepare('INSERT INTO tasks(user_id,title,description,status,priority,due_date) VALUES(?,?,?,?,?,?)').run(req.user.id, title.trim(), description.trim(), status, priority, dueDate);
  const task = taskFromRow(getTask(result.lastInsertRowid));
  io.to('class:04-web-tech').emit('task:created', { task, actor: req.user.name, at: new Date().toISOString() });
  return res.status(201).json({ success: true, data: { task } });
});
app.put('/api/tasks/:id', auth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, 'INVALID_ID', 'Task ID must be a positive integer.');
  const current = getTask(id);
  if (!current) return fail(res, 404, 'TASK_NOT_FOUND', 'Task not found.');
  const { title = current.title, description = current.description, status = current.status, priority = current.priority, dueDate = current.due_date } = req.body;
  if (!validString(title, 3, 120)) return fail(res, 400, 'VALIDATION_ERROR', 'Title must be 3–120 characters.');
  if (typeof description !== 'string' || description.length > 500) return fail(res, 400, 'VALIDATION_ERROR', 'Description must be at most 500 characters.');
  if (!['todo', 'doing', 'done'].includes(status) || !['low', 'normal', 'high'].includes(priority)) return fail(res, 400, 'VALIDATION_ERROR', 'Choose a valid status and priority.');
  if (dueDate !== null && (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) return fail(res, 400, 'VALIDATION_ERROR', 'Due date must use YYYY-MM-DD.');
  db.prepare(`UPDATE tasks SET title=?,description=?,status=?,priority=?,due_date=?,updated_at=datetime('now') WHERE id=?`).run(title.trim(), description.trim(), status, priority, dueDate, id);
  const task = taskFromRow(getTask(id));
  io.to('class:04-web-tech').emit('task:updated', { task, actor: req.user.name, at: new Date().toISOString() });
  return res.json({ success: true, data: { task } });
});
app.delete('/api/tasks/:id', auth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, 'INVALID_ID', 'Task ID must be a positive integer.');
  const task = getTask(id);
  if (!task) return fail(res, 404, 'TASK_NOT_FOUND', 'Task not found.');
  db.prepare('DELETE FROM tasks WHERE id=?').run(id);
  const payload = { id, title: task.title, actor: req.user.name, at: new Date().toISOString() };
  io.to('class:04-web-tech').emit('task:deleted', payload);
  return res.json({ success: true, data: { deleted: true, id } });
});

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = { id: Number(payload.sub), name: payload.name };
    next();
  } catch { next(new Error('Invalid or expired session')); }
});
io.on('connection', socket => {
  socket.join('class:04-web-tech');
  io.to('class:04-web-tech').emit('presence:count', { count: io.sockets.adapter.rooms.get('class:04-web-tech')?.size || 1 });
  socket.on('disconnect', () => io.to('class:04-web-tech').emit('presence:count', { count: io.sockets.adapter.rooms.get('class:04-web-tech')?.size || 0 }));
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => fail(res, 404, 'NOT_FOUND', 'The requested resource was not found.'));
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}]`, err.message);
  if (res.headersSent) return next(err);
  if (err instanceof SyntaxError && 'body' in err) return fail(res, 400, 'INVALID_JSON', 'Request body must contain valid JSON.');
  return fail(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
});

server.listen(PORT, '0.0.0.0', () => console.log(`PulseBoard listening on http://0.0.0.0:${PORT}`));
