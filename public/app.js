(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const tokenKey = 'pulseboard_token';
  let token = sessionStorage.getItem(tokenKey);
  let currentUser = null;
  let tasks = [];
  let socket = null;
  let filter = 'all';
  let toastTimer;

  const authView = $('#authView'), appView = $('#appView');
  const escapeText = value => String(value ?? '');
  function notify(message, error = false) {
    const toast = $('#toast'); toast.textContent = message; toast.classList.toggle('error', error); toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }
  async function api(url, options = {}) {
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers };
    let response;
    try { response = await fetch(url, { ...options, headers }); }
    catch { throw new Error('Can’t reach PulseBoard right now. Check your connection and retry.'); }
    let body;
    try { body = await response.json(); } catch { throw new Error('The server returned an unreadable response.'); }
    if (!response.ok || body.success === false) {
      const err = new Error(body?.error?.message || `Request failed (${response.status}).`); err.status = response.status; err.code = body?.error?.code; throw err;
    }
    return body.data;
  }
  function showAuth(message = '') {
    authView.hidden = false; appView.hidden = true;
    $('#authError').hidden = !message; $('#authError').textContent = message;
    if (socket) { socket.disconnect(); socket = null; }
  }
  function showApp(user) {
    currentUser = user; authView.hidden = true; appView.hidden = false;
    const first = user.name.split(/\s+/)[0];
    $('#welcomeName').textContent = first; $('#userName').textContent = user.name; $('#userEmail').textContent = user.email;
    $('#userAvatar').textContent = user.name[0].toUpperCase(); $('#topAvatar').textContent = user.name[0].toUpperCase();
    const hour = new Date().getHours(); $('#todayLabel').textContent = `${hour < 12 ? 'GOOD MORNING' : hour < 18 ? 'GOOD AFTERNOON' : 'GOOD EVENING'} · CLASSROOM OVERVIEW`;
    connectSocket(); loadTasks();
  }
  async function loadTasks() {
    try { const data = await api('/api/tasks'); tasks = data.tasks; render(); $('#lastUpdated').textContent = `Last synced ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; }
    catch (error) { if (error.status === 401) signOut(); else notify(error.message, true); }
  }
  function connectSocket() {
    if (!window.io) { setConnection(false, 'Live connection unavailable'); return; }
    if (socket) socket.disconnect();
    socket = window.io({ auth: { token }, reconnectionAttempts: 5, reconnectionDelay: 700 });
    socket.on('connect', () => setConnection(true, 'Live updates on'));
    socket.on('disconnect', () => setConnection(false, 'Reconnecting…'));
    socket.on('connect_error', () => setConnection(false, 'Live connection unavailable'));
    socket.on('presence:count', data => { $('#onlineCount').textContent = `${data.count} ${data.count === 1 ? 'person' : 'people'}`; });
    socket.on('task:created', payload => { if (!tasks.some(t => t.id === payload.task.id)) tasks.unshift(payload.task); render(); addActivity('created', payload); });
    socket.on('task:updated', payload => { tasks = tasks.map(t => t.id === payload.task.id ? payload.task : t); render(); addActivity('updated', payload); });
    socket.on('task:deleted', payload => { tasks = tasks.filter(t => t.id !== payload.id); render(); addActivity('deleted', payload); });
  }
  function setConnection(online, text) { const el = $('#connectionState'); el.classList.toggle('offline', !online); el.querySelector('span:last-child').textContent = text; }
  function render() {
    const query = $('#searchInput').value.trim().toLowerCase();
    const visible = tasks.filter(task => (filter === 'all' || task.status === filter) && (!query || `${task.title} ${task.description}`.toLowerCase().includes(query)));
    const counts = { todo: tasks.filter(t => t.status === 'todo').length, doing: tasks.filter(t => t.status === 'doing').length, done: tasks.filter(t => t.status === 'done').length };
    $('#allCount').textContent = String(tasks.length).padStart(2, '0'); $('#doingCount').textContent = String(counts.doing).padStart(2, '0'); $('#doneCount').textContent = String(counts.done).padStart(2, '0');
    $('#sideTaskCount').textContent = String(tasks.length).padStart(2, '0'); $('#taskCountLabel').textContent = `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;
    Object.entries({ todo: 'todoList', doing: 'doingList', done: 'doneList' }).forEach(([status, listId]) => {
      const items = visible.filter(t => t.status === status); $(`#${listId}`).replaceChildren();
      $(`#${status}LaneCount`).textContent = items.length;
      if (!items.length) { const empty = document.createElement('div'); empty.className = 'empty-lane'; empty.textContent = query || filter !== 'all' ? 'No matching tasks' : 'Nothing here yet'; $(`#${listId}`).append(empty); }
      items.forEach(task => $(`#${listId}`).append(makeCard(task)));
    });
  }
  function makeCard(task) {
    const card = document.createElement('article'); card.className = `task-card priority-${task.priority}`; card.dataset.id = task.id;
    const top = document.createElement('div'); top.className = 'card-top'; const priority = document.createElement('span'); priority.className = 'priority-label'; priority.textContent = `${task.priority} priority`; top.append(priority);
    const menuWrap = document.createElement('div'); menuWrap.className = 'task-menu'; const menuButton = document.createElement('button'); menuButton.type = 'button'; menuButton.textContent = '···'; menuButton.setAttribute('aria-label', `Actions for ${task.title}`); menuButton.onclick = e => { e.stopPropagation(); const old = $('.task-menu-pop', menuWrap); if (old) { old.remove(); return; } const pop = document.createElement('div'); pop.className = 'task-menu-pop'; const edit = document.createElement('button'); edit.textContent = 'Edit task'; edit.onclick = () => { pop.remove(); openTaskDialog(task); }; const del = document.createElement('button'); del.textContent = 'Delete task'; del.className = 'danger'; del.onclick = () => { pop.remove(); deleteTask(task); }; pop.append(edit, del); menuWrap.append(pop); }; menuWrap.append(menuButton); top.append(menuWrap);
    const title = document.createElement('h4'); title.textContent = task.title;
    const description = document.createElement('p'); description.textContent = task.description || 'No description provided.';
    const foot = document.createElement('div'); foot.className = 'card-foot'; const due = document.createElement('span'); due.className = 'due-label'; due.textContent = task.dueDate ? `◷ ${new Date(`${task.dueDate}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : `◷ ${new Date(task.updatedAt.replace(' ', 'T') + 'Z').toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    const owner = document.createElement('span'); owner.className = `card-owner ${task.creatorId % 3 === 0 ? 'purple' : task.creatorId % 3 === 1 ? '' : 'peach'}`; owner.textContent = task.createdBy?.[0]?.toUpperCase() || 'P'; owner.title = `Created by ${task.createdBy || 'class member'}`;
    const move = document.createElement('select'); move.className = 'move-select'; move.setAttribute('aria-label', `Move ${task.title}`); [['todo','To do'],['doing','In progress'],['done','Completed']].forEach(([value,label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; option.selected = task.status === value; move.append(option); }); move.onchange = () => updateTask(task.id, { status: move.value }); foot.append(due, owner, move);
    card.append(top, title, description, foot); return card;
  }
  function addActivity(kind, payload) {
    const feed = $('#activityFeed'); const empty = $('.empty-activity', feed); if (empty) empty.remove();
    const item = document.createElement('div'); item.className = 'activity-item'; const icon = document.createElement('span'); icon.className = `activity-icon ${kind}`; icon.textContent = kind === 'created' ? '+' : kind === 'updated' ? '↻' : '×';
    const copy = document.createElement('div'); copy.className = 'activity-copy'; const action = kind === 'created' ? 'added' : kind === 'updated' ? 'updated' : 'removed'; const who = document.createElement('strong'); who.textContent = payload.actor || 'A classmate'; copy.append(who, document.createTextNode(` ${action} “${payload.task?.title || payload.title}”`)); const time = document.createElement('time'); time.textContent = 'just now · live'; copy.append(time); item.append(icon, copy); feed.prepend(item); while (feed.children.length > 12) feed.lastElementChild.remove();
  }
  function openTaskDialog(task = null, status = 'todo') {
    $('#taskForm').reset(); $('#formError').hidden = true; $('#taskId').value = task?.id || ''; $('#taskTitle').value = task?.title || ''; $('#taskDescription').value = task?.description || ''; $('#taskStatus').value = task?.status || status; $('#taskPriority').value = task?.priority || 'normal'; $('#taskDueDate').value = task?.dueDate || '';
    $('#dialogTitle').textContent = task ? 'Edit task' : 'Create a task'; $('#dialogEyebrow').textContent = task ? 'UPDATE BOARD ITEM' : 'NEW BOARD ITEM'; $('#saveTaskButton').innerHTML = task ? 'Save changes <span>→</span>' : 'Create task <span>→</span>';
    $('#taskDialog').showModal(); $('#taskTitle').focus();
  }
  async function updateTask(id, patch) {
    try { const data = await api(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(patch) }); tasks = tasks.map(t => t.id === id ? data.task : t); render(); notify('Task updated.'); }
    catch (error) { notify(error.message, true); loadTasks(); }
  }
  async function deleteTask(task) {
    if (!window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return;
    try { await api(`/api/tasks/${task.id}`, { method: 'DELETE' }); tasks = tasks.filter(t => t.id !== task.id); render(); notify('Task deleted.'); }
    catch (error) { notify(error.message, true); }
  }
  function signOut() { sessionStorage.removeItem(tokenKey); token = null; currentUser = null; if (socket) socket.disconnect(); showAuth(); }

  let registerMode = false;
  $('#authSwitch').addEventListener('click', e => {
    if (e.target.id !== 'switchAuth') return;
    registerMode = !registerMode;
    $('#nameField').hidden = !registerMode;
    $('#authTitle').textContent = registerMode ? 'Create your account' : 'Welcome back';
    $('#authEyebrow').textContent = registerMode ? 'START YOUR CLASSROOM WORKSPACE' : 'YOUR CLASSROOM WORKSPACE';
    $('#authSubtitle').textContent = registerMode ? 'Bring your class together in one shared space.' : 'Sign in to pick up where your class left off.';
    $('#authSubmit').innerHTML = registerMode ? 'Create account <span aria-hidden="true">→</span>' : 'Sign in <span aria-hidden="true">→</span>';
    $('#authSwitch').innerHTML = registerMode ? 'Already have an account? <button id="switchAuth" class="text-button" type="button">Sign in</button>' : 'New to PulseBoard? <button id="switchAuth" class="text-button" type="button">Create an account</button>';
    $('#passwordInput').autocomplete = registerMode ? 'new-password' : 'current-password';
  });
  $('#authForm').addEventListener('submit', async e => {
    e.preventDefault(); const errorBox = $('#authError'); errorBox.hidden = true;
    const payload = { email: $('#emailInput').value.trim(), password: $('#passwordInput').value }; if (registerMode) payload.name = $('#nameInput').value.trim();
    const submit = $('#authSubmit'); submit.disabled = true; submit.textContent = registerMode ? 'Creating account…' : 'Signing in…';
    try { const data = await api(registerMode ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }); token = data.token; sessionStorage.setItem(tokenKey, token); showApp(data.user); }
    catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; }
    finally { submit.disabled = false; submit.innerHTML = registerMode ? 'Create account <span aria-hidden="true">→</span>' : 'Sign in <span aria-hidden="true">→</span>'; }
  });
  $('#demoLogin').addEventListener('click', () => { $('#emailInput').value = 'demo@pulseboard.app'; $('#passwordInput').value = 'Classroom2026!'; $('#authForm').requestSubmit(); });
  $('#newTaskButton').addEventListener('click', () => openTaskDialog());
  $$('[data-add-status]').forEach(button => button.addEventListener('click', () => openTaskDialog(null, button.dataset.addStatus)));
  $('#closeDialog').addEventListener('click', () => $('#taskDialog').close()); $('#cancelDialog').addEventListener('click', () => $('#taskDialog').close());
  $('#taskForm').addEventListener('submit', async e => {
    e.preventDefault(); const id = $('#taskId').value; const payload = { title: $('#taskTitle').value.trim(), description: $('#taskDescription').value.trim(), status: $('#taskStatus').value, priority: $('#taskPriority').value, dueDate: $('#taskDueDate').value || null };
    try { const data = await api(id ? `/api/tasks/${id}` : '/api/tasks', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); if (id) tasks = tasks.map(t => t.id === Number(id) ? data.task : t); else tasks.unshift(data.task); render(); $('#taskDialog').close(); notify(id ? 'Changes saved.' : 'Task added to the board.'); }
    catch (error) { $('#formError').textContent = error.message; $('#formError').hidden = false; }
  });
  $('#searchInput').addEventListener('input', render);
  $('#filterButton').addEventListener('click', () => { $('#filterMenu').hidden = !$('#filterMenu').hidden; });
  $$('#filterMenu button').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; $('#filterLabel').textContent = button.textContent; $('#filterMenu').hidden = true; render(); }));
  $('#logoutButton').addEventListener('click', signOut);
  $('#activityNav').addEventListener('click', () => $('#activityPanel').classList.toggle('open'));
  $('#closeActivity').addEventListener('click', () => $('#activityPanel').classList.remove('open'));
  document.addEventListener('click', e => { if (!e.target.closest('.task-menu')) $$('.task-menu-pop').forEach(p => p.remove()); if (!e.target.closest('.board-tools')) $('#filterMenu').hidden = true; });

  if (token) api('/api/auth/me').then(data => showApp(data.user)).catch(() => { sessionStorage.removeItem(tokenKey); token = null; showAuth(); });
  else showAuth();
})();
