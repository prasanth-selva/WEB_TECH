const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const net = require('node:net');

let child, base, port, serverOutput = '';
const secret = 'integration-test-secret-long-enough-2026';
async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject);
  });
}
async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early: ${serverOutput}`);
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`Server did not start: ${serverOutput}`);
}
async function json(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { response, data: await response.json() };
}
function registerUser(email, name = 'Test Student') { return json('/api/auth/register', { method: 'POST', body: { name, email, password: 'StudyTogether123!' } }); }

before(async () => {
  port = await freePort(); base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), JWT_SECRET: secret }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { serverOutput += chunk; }); child.stderr.on('data', chunk => { serverOutput += chunk; });
  await waitForServer();
});
after(() => { if (child && child.exitCode === null) child.kill('SIGTERM'); });

test('health check confirms server and SQLite connectivity', async () => {
  const { response, data } = await json('/api/health');
  assert.equal(response.status, 200); assert.equal(data.success, true); assert.equal(data.data.database, true);
});

test('auth protects data and registration/login return a bearer token', async () => {
  const unauth = await json('/api/tasks'); assert.equal(unauth.response.status, 401); assert.equal(unauth.data.error.code, 'AUTH_REQUIRED');
  const email = `integration-${Date.now()}@example.test`;
  const created = await registerUser(email); assert.equal(created.response.status, 201); assert.ok(created.data.data.token);
  const logged = await json('/api/auth/login', { method: 'POST', body: { email, password: 'StudyTogether123!' } }); assert.equal(logged.response.status, 200);
  const wrong = await json('/api/auth/login', { method: 'POST', body: { email, password: 'wrong-password' } }); assert.equal(wrong.response.status, 401);
  return { email, token: created.data.data.token, user: created.data.data.user };
});

test('REST task CRUD validates JSON and lets authenticated classmates collaborate', async () => {
  const email = `crud-${Date.now()}@example.test`;
  const signup = await registerUser(email); const token = signup.data.data.token;
  const initial = await json('/api/tasks', { token }); assert.equal(initial.response.status, 200); const initialCount = initial.data.data.tasks.length;
  const malformed = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{broken json' });
  assert.equal(malformed.status, 400); assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
  const invalid = await json('/api/tasks', { method: 'POST', token, body: { title: 'x' } }); assert.equal(invalid.response.status, 400); assert.equal(invalid.data.error.code, 'VALIDATION_ERROR');
  const marker = `API${Date.now()}`;
  const created = await json('/api/tasks', { method: 'POST', token, body: { title: `Build ${marker} demo`, description: 'Show JSON create', status: 'todo', priority: 'high' } });
  assert.equal(created.response.status, 201); const id = created.data.data.task.id; assert.ok(id > 0); assert.equal(created.data.data.task.createdBy, 'Test Student');
  const filtered = await json(`/api/tasks?status=todo&q=${marker}`, { token }); assert.equal(filtered.data.data.tasks.length, 1);
  const updated = await json(`/api/tasks/${id}`, { method: 'PUT', token, body: { title: 'Build REST and socket demo', status: 'doing', priority: 'normal' } }); assert.equal(updated.response.status, 200); assert.equal(updated.data.data.task.status, 'doing');
  const invalidFilter = await json('/api/tasks?status=invalid', { token }); assert.equal(invalidFilter.response.status, 400);
  const other = await registerUser(`other-${Date.now()}@example.test`, 'Another Learner');
  const sharedList = await json('/api/tasks', { token: other.data.data.token }); assert.ok(sharedList.data.data.tasks.some(task => task.id === id));
  const collaboration = await json(`/api/tasks/${id}`, { method: 'PUT', token: other.data.data.token, body: { title: 'Updated by another classmate', status: 'doing' } }); assert.equal(collaboration.response.status, 200); assert.equal(collaboration.data.data.task.createdBy, 'Test Student');
  const deleted = await json(`/api/tasks/${id}`, { method: 'DELETE', token }); assert.equal(deleted.response.status, 200); assert.equal(deleted.data.data.deleted, true);
  const missing = await json(`/api/tasks/${id}`, { method: 'DELETE', token }); assert.equal(missing.response.status, 404);
  const list = await json('/api/tasks', { token }); assert.equal(list.data.data.tasks.length, initialCount);
});

test('different authenticated classmates receive shared Socket.IO task events', async () => {
  const signup = await registerUser(`socket-${Date.now()}@example.test`); const token = signup.data.data.token;
  const classmate = await registerUser(`subscriber-${Date.now()}@example.test`, 'Classmate Lee');
  const client = io(base, { auth: { token: classmate.data.data.token }, transports: ['websocket'], reconnection: false, timeout: 5000 });
  try {
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
    const event = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('task:created event timed out')), 5000); client.once('task:created', value => { clearTimeout(timer); resolve(value); }); });
    const created = await json('/api/tasks', { method: 'POST', token, body: { title: 'Socket event check', description: 'Must arrive without refresh', status: 'todo', priority: 'normal' } });
    assert.equal(created.response.status, 201); const payload = await event; assert.equal(payload.task.title, 'Socket event check'); assert.equal(payload.actor, 'Test Student');
    await json(`/api/tasks/${payload.task.id}`, { method: 'DELETE', token });
  } finally { client.disconnect(); }
});
