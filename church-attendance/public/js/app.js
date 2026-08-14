const api = {
  async call(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
  get(url) { return this.call('GET', url); },
  post(url, body) { return this.call('POST', url, body); },
  put(url, body) { return this.call('PUT', url, body); },
  del(url) { return this.call('DELETE', url); }
};

function toast(msg, isError = false) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function fmtDate(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtTime(d) {
  const dt = new Date(d);
  return dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---------------- Auth ----------------
async function checkAuth() {
  try {
    const me = await api.get('/api/me');
    showApp(me);
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-shell').style.display = 'none';
}

async function showApp(user) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';
  document.getElementById('sidebar-user').textContent = 'Signed in as ' + user.username;
  await loadBranches();
  navigate('dashboard');
}

// ---------------- Branches (multi-campus support) ----------------
let branches = [];
let currentBranchId = Number(localStorage.getItem('clbc_branch_id')) || null;

async function loadBranches() {
  branches = await api.get('/api/branches');
  if (!branches.length) return;
  if (!currentBranchId || !branches.some((b) => b.id === currentBranchId)) {
    currentBranchId = branches[0].id;
  }
  localStorage.setItem('clbc_branch_id', currentBranchId);
  const select = document.getElementById('branch-select');
  select.innerHTML = branches.map((b) => `<option value="${b.id}" ${b.id === currentBranchId ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('');
}

document.getElementById('branch-select').addEventListener('change', (e) => {
  currentBranchId = Number(e.target.value);
  localStorage.setItem('clbc_branch_id', currentBranchId);
  navigate(currentPage);
});

document.getElementById('login-btn').addEventListener('click', doLogin);
document.getElementById('login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const user = await api.post('/api/login', { username, password });
    showApp(user);
  } catch (e) {
    errEl.textContent = e.message;
  }
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/logout');
  showLogin();
});

// ---------------- Nav ----------------
let currentPage = 'dashboard';
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => navigate(item.dataset.page));
});

function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === page));
  const renderers = { dashboard: renderDashboard, checkin: renderCheckin, sessions: renderSessions, members: renderMembers, branches: renderBranches };
  renderers[page]();
}

const main = document.getElementById('main');

// ---------------- Dashboard ----------------
let dashScope = 'branch'; // 'branch' | 'all'

async function renderDashboard() {
  const currentBranch = branches.find((b) => b.id === currentBranchId);
  main.innerHTML = `<div class="page-header">
      <div><h2>Dashboard</h2><p>Overview of membership and recent attendance.</p></div>
      <div class="scope-toggle">
        <button class="scope-btn ${dashScope === 'branch' ? 'active' : ''}" id="scope-branch">${currentBranch ? escapeHtml(currentBranch.name) : 'This branch'}</button>
        <button class="scope-btn ${dashScope === 'all' ? 'active' : ''}" id="scope-all">All branches</button>
      </div>
    </div>
    <div id="dash-content">Loading…</div>`;
  document.getElementById('scope-branch').addEventListener('click', () => { dashScope = 'branch'; renderDashboard(); });
  document.getElementById('scope-all').addEventListener('click', () => { dashScope = 'all'; renderDashboard(); });

  try {
    const qs = dashScope === 'all' ? 'all' : currentBranchId;
    const stats = await api.get(`/api/dashboard/stats?branchId=${qs}`);
    const dash = document.getElementById('dash-content');
    dash.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-num">${stats.totalMembers}</div><div class="stat-label">Members</div></div>
        <div class="stat-card"><div class="stat-num">${stats.totalSessions}</div><div class="stat-label">Services logged</div></div>
        <div class="stat-card accent"><div class="stat-num">${stats.lastSession ? stats.lastSession.count : 0}</div><div class="stat-label">Last service attendance</div></div>
        <div class="stat-card"><div class="stat-num">${stats.totalVisitorsAllTime}</div><div class="stat-label">Visitors recorded</div></div>
      </div>
      <div class="chart-wrap">
        <h3 style="margin-top:0;">Attendance trend — last ${stats.trend.length} services</h3>
        <canvas id="trendChart" height="90"></canvas>
      </div>
      ${stats.isAll ? `
        <div class="card" style="margin-top:20px;">
          <div class="card-header"><h3>By branch</h3></div>
          <div>${renderBranchBreakdownTable(stats.byBranch)}</div>
        </div>` : ''}
      `;
    if (stats.trend.length) {
      const ctx = document.getElementById('trendChart').getContext('2d');
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: stats.trend.map((t) => t.title + ' · ' + fmtDate(t.date)),
          datasets: [{
            label: 'Attendance',
            data: stats.trend.map((t) => t.count),
            borderColor: '#A9782E',
            backgroundColor: 'rgba(169,120,46,0.15)',
            tension: 0.3,
            fill: true,
            pointBackgroundColor: '#2F6E62'
          }]
        },
        options: {
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        }
      });
    } else {
      document.querySelector('.chart-wrap').innerHTML += `<p style="color:var(--ink-soft); font-size:13.5px;">No services logged yet — add one under "Services" to start tracking attendance.</p>`;
    }
  } catch (e) {
    document.getElementById('dash-content').innerHTML = `<p>Could not load dashboard: ${escapeHtml(e.message)}</p>`;
  }
}

function renderBranchBreakdownTable(byBranch) {
  if (!byBranch.length) return `<div class="empty-state">No branches yet.</div>`;
  return `<table>
    <thead><tr><th>Branch</th><th>Members</th><th>Services</th><th>Last service</th></tr></thead>
    <tbody>${byBranch.map((b) => `
      <tr>
        <td><strong>${escapeHtml(b.branchName)}</strong></td>
        <td>${b.totalMembers}</td>
        <td>${b.totalSessions}</td>
        <td>${b.lastSession ? `${escapeHtml(b.lastSession.title)} — <span class="badge-count">${b.lastSession.count}</span>` : '—'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
}

// ---------------- Members ----------------
async function renderMembers() {
  const currentBranch = branches.find((b) => b.id === currentBranchId);
  main.innerHTML = `<div class="page-header">
      <div><h2>Members</h2><p>${currentBranch ? escapeHtml(currentBranch.name) : ''} — members, volunteers, and visitors.</p></div>
      <div style="display:flex; gap:8px;">
        <button class="btn-ghost" id="import-members-btn">Bulk import</button>
        <button class="btn-brass" id="add-member-btn">+ Add member</button>
      </div>
    </div>
    <div class="card"><div id="members-table"></div></div>`;
  document.getElementById('add-member-btn').addEventListener('click', () => openMemberModal());
  document.getElementById('import-members-btn').addEventListener('click', () => openBulkImportModal());
  await loadMembersTable();
}

async function loadMembersTable() {
  const target = document.getElementById('members-table');
  target.innerHTML = 'Loading…';
  const members = await api.get(`/api/members?branchId=${currentBranchId}`);
  if (!members.length) {
    target.innerHTML = `<div class="empty-state"><div class="glyph">◇</div>No members yet. Add your first member to begin.</div>`;
    return;
  }
  target.innerHTML = `<table>
    <thead><tr><th>Name</th><th>Group</th><th>Category</th><th>Contact</th><th></th></tr></thead>
    <tbody>${members.map((m) => `
      <tr>
        <td><strong>${escapeHtml(m.firstName)} ${escapeHtml(m.lastName)}</strong></td>
        <td>${escapeHtml(m.group)}</td>
        <td><span class="tag ${m.category === 'Visitor' ? 'visitor' : ''} ${m.category === 'Not Regularized' ? 'pending' : ''}">${escapeHtml(m.category)}</span></td>
        <td>${escapeHtml(m.email || m.phone || '—')}</td>
        <td style="text-align:right;">
          <button class="btn-ghost btn-sm" onclick="openMemberModal(${m.id})">Edit</button>
          <button class="btn-danger btn-sm" onclick="deleteMember(${m.id})">Delete</button>
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
}

async function openMemberModal(id) {
  const members = id ? await api.get('/api/members') : [];
  const member = id ? members.find((m) => m.id === id) : null;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="width:480px; max-height:85vh; overflow-y:auto;">
      <h3>${member ? 'Edit member' : 'Add member'}</h3>
      <div class="field-row">
        <div class="field"><label>First name</label><input id="m-first" value="${member ? escapeHtml(member.firstName) : ''}" /></div>
        <div class="field"><label>Last name</label><input id="m-last" value="${member ? escapeHtml(member.lastName) : ''}" /></div>
      </div>
      <div class="field"><label>Group / Ministry</label><input id="m-group" placeholder="e.g. Youth, Choir, General" value="${member ? escapeHtml(member.group) : ''}" /></div>
      <div class="field-row">
        <div class="field"><label>Category</label>
          <select id="m-category">
            <option ${member?.category === 'Member' || !member ? 'selected' : ''}>Member</option>
            <option ${member?.category === 'Volunteer' ? 'selected' : ''}>Volunteer</option>
            <option ${member?.category === 'Visitor' ? 'selected' : ''}>Visitor</option>
            <option ${member?.category === 'Not Regularized' ? 'selected' : ''}>Not Regularized</option>
          </select>
        </div>
        <div class="field"><label>Gender</label>
          <select id="m-gender">
            <option value="" ${!member?.gender ? 'selected' : ''}>—</option>
            <option ${member?.gender === 'Male' ? 'selected' : ''}>Male</option>
            <option ${member?.gender === 'Female' ? 'selected' : ''}>Female</option>
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Email</label><input id="m-email" value="${member ? escapeHtml(member.email) : ''}" /></div>
        <div class="field"><label>Phone</label><input id="m-phone" value="${member ? escapeHtml(member.phone) : ''}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Date of birth</label><input id="m-dob" type="date" value="${member?.dateOfBirth || ''}" /></div>
        <div class="field"><label>Home cell</label><input id="m-cell" value="${member ? escapeHtml(member.homeCell || '') : ''}" /></div>
      </div>
      <div class="field"><label>Rhema / discipleship class</label><input id="m-rhema" value="${member ? escapeHtml(member.rhemaClass || '') : ''}" /></div>
      <div class="field"><label>Picture URL</label><input id="m-picture" placeholder="https://…" value="${member ? escapeHtml(member.pictureUrl || '') : ''}" /></div>
      <div class="field"><label>Spiritual gifts (comma-separated)</label><input id="m-gifts" placeholder="e.g. Helps, Hospitality, Mercy" value="${member?.spiritualGifts ? escapeHtml(member.spiritualGifts.join(', ')) : ''}" /></div>
      <div class="modal-actions">
        <button class="btn-ghost" id="m-cancel">Cancel</button>
        <button class="btn-primary" id="m-save">${member ? 'Save changes' : 'Add member'}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#m-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#m-save').addEventListener('click', async () => {
    const payload = {
      firstName: backdrop.querySelector('#m-first').value.trim(),
      lastName: backdrop.querySelector('#m-last').value.trim(),
      group: backdrop.querySelector('#m-group').value.trim() || 'General',
      category: backdrop.querySelector('#m-category').value,
      gender: backdrop.querySelector('#m-gender').value,
      email: backdrop.querySelector('#m-email').value.trim(),
      phone: backdrop.querySelector('#m-phone').value.trim(),
      dateOfBirth: backdrop.querySelector('#m-dob').value,
      homeCell: backdrop.querySelector('#m-cell').value.trim(),
      rhemaClass: backdrop.querySelector('#m-rhema').value.trim(),
      pictureUrl: backdrop.querySelector('#m-picture').value.trim(),
      spiritualGifts: backdrop.querySelector('#m-gifts').value.split(',').map((g) => g.trim()).filter(Boolean),
      branchId: currentBranchId
    };
    if (!payload.firstName || !payload.lastName) { toast('First and last name are required', true); return; }
    try {
      if (member) await api.put(`/api/members/${member.id}`, payload);
      else await api.post('/api/members', payload);
      backdrop.remove();
      toast(member ? 'Member updated' : 'Member added');
      loadMembersTable();
    } catch (e) { toast(e.message, true); }
  });
}

async function deleteMember(id) {
  if (!confirm('Remove this member? This cannot be undone.')) return;
  try {
    await api.del(`/api/members/${id}`);
    toast('Member removed');
    loadMembersTable();
  } catch (e) { toast(e.message, true); }
}

// ---------------- Bulk import (CSV) ----------------
function parseCSV(text) {
  // Minimal CSV parser: handles quoted fields, commas inside quotes, and CRLF/LF.
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // skip, \n handles the row break
    } else {
      field += c;
    }
  }
  if (field.length || row.length) pushRow();
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function csvRowsToMembers(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names) => header.findIndex((h) => names.includes(h));
  const idx = {
    firstName: col(['first name', 'firstname', 'first']),
    lastName: col(['last name', 'lastname', 'last', 'surname']),
    email: col(['email', 'email address']),
    phone: col(['phone', 'phone number', 'mobile', 'telephone number', 'telephone']),
    group: col(['group', 'ministry', 'group / ministry', 'ministry or group']),
    category: col(['category', 'type', 'membership status']),
    branchName: col(['branch', 'chapel', 'campus']),
    gender: col(['gender', 'sex']),
    dateOfBirth: col(['date of birth', 'dob', 'birthday']),
    rhemaClass: col(['rhema class', 'class']),
    homeCell: col(['home cell', 'cell', 'small group']),
    pictureUrl: col(['picture', 'picture url', 'photo']),
    spiritualGift1: col(['spiritual gift 1']),
    spiritualGift2: col(['spiritual gift 2']),
    spiritualGift3: col(['spiritual gift 3'])
  };
  const get = (r, key) => (idx[key] > -1 ? (r[idx[key]] || '').trim() : '');
  return rows.slice(1).map((r) => ({
    firstName: get(r, 'firstName'),
    lastName: get(r, 'lastName'),
    email: get(r, 'email'),
    phone: get(r, 'phone'),
    group: get(r, 'group'),
    category: get(r, 'category'),
    branchName: get(r, 'branchName'),
    gender: get(r, 'gender'),
    dateOfBirth: get(r, 'dateOfBirth'),
    rhemaClass: get(r, 'rhemaClass'),
    homeCell: get(r, 'homeCell'),
    pictureUrl: get(r, 'pictureUrl'),
    spiritualGift1: get(r, 'spiritualGift1'),
    spiritualGift2: get(r, 'spiritualGift2'),
    spiritualGift3: get(r, 'spiritualGift3')
  }));
}

function downloadCSVTemplate() {
  const csv = 'First Name,Last Name,Email,Phone,Group,Category,Chapel,Gender,Date of Birth,Rhema Class,Home Cell,Picture,Spiritual Gift 1,Spiritual Gift 2,Spiritual Gift 3\nAma,Boateng,ama@example.com,0244000000,Choir,Member,Life Cathedral - main service,Female,1990-05-14,Adult Class,Bethel Cell,,Helps,Hospitality,\nKofi,Mensah,,0209000000,Youth,Volunteer,Oasis - Youth Chapel,Male,,,,,\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'member-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function openBulkImportModal() {
  const currentBranch = branches.find((b) => b.id === currentBranchId);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="width:540px;">
      <h3>Bulk import members</h3>
      <p style="font-size:13.5px; color:var(--ink-soft); margin-top:-8px;">
        Upload a CSV. Only First Name and Last Name are required — everything else
        (Email, Phone, Group, Category, Gender, Date of Birth, Rhema Class, Home Cell,
        Picture, Spiritual Gifts) is optional.
      </p>
      <p style="font-size:13.5px; color:var(--ink-soft); margin-top:-4px;">
        If your file has a <strong>Branch</strong> or <strong>Chapel</strong> column,
        each row is routed to that branch automatically — new branches are created as
        needed. Rows without one import into
        <strong>${currentBranch ? escapeHtml(currentBranch.name) : 'the selected branch'}</strong>.
      </p>
      <button class="btn-ghost btn-sm" id="download-template-btn" style="margin-bottom:14px;">Download CSV template</button>
      <div class="field">
        <label>CSV file</label>
        <input type="file" id="bi-file" accept=".csv,text/csv" />
      </div>
      <div id="bi-preview"></div>
      <div class="modal-actions">
        <button class="btn-ghost" id="bi-cancel">Cancel</button>
        <button class="btn-brass" id="bi-import" disabled>Import</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#bi-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#download-template-btn').addEventListener('click', downloadCSVTemplate);

  let parsedMembers = [];
  const importBtn = backdrop.querySelector('#bi-import');
  const previewEl = backdrop.querySelector('#bi-preview');

  backdrop.querySelector('#bi-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCSV(reader.result);
      parsedMembers = csvRowsToMembers(rows).filter((m) => m.firstName || m.lastName);
      const valid = parsedMembers.filter((m) => m.firstName && m.lastName);
      const invalidCount = parsedMembers.length - valid.length;
      if (!parsedMembers.length) {
        previewEl.innerHTML = `<p style="color:var(--alert); font-size:13.5px;">No rows found — check the file has a header row and at least one data row.</p>`;
        importBtn.disabled = true;
        return;
      }
      const branchNames = [...new Set(valid.map((m) => m.branchName).filter(Boolean))];
      previewEl.innerHTML = `
        <p style="font-size:13.5px; margin-bottom:6px;"><strong>${valid.length}</strong> member${valid.length === 1 ? '' : 's'} ready to import${invalidCount ? `, <strong>${invalidCount}</strong> row(s) skipped (missing name)` : ''}.</p>
        ${branchNames.length ? `<p style="font-size:12.5px; color:var(--ink-soft); margin-bottom:6px;">Branches detected: ${branchNames.map((n) => escapeHtml(n)).join(', ')}</p>` : ''}
        <div style="max-height:160px; overflow-y:auto; border:1px solid var(--line); border-radius:8px;">
          <table style="font-size:12.5px;">
            <thead><tr><th>Name</th><th>Branch</th><th>Category</th></tr></thead>
            <tbody>${valid.slice(0, 8).map((m) => `<tr><td>${escapeHtml(m.firstName)} ${escapeHtml(m.lastName)}</td><td>${escapeHtml(m.branchName || (currentBranch ? currentBranch.name : ''))}</td><td>${escapeHtml(m.category || 'Member')}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        ${valid.length > 8 ? `<p style="font-size:12px; color:var(--ink-soft); margin-top:4px;">…and ${valid.length - 8} more.</p>` : ''}`;
      importBtn.disabled = valid.length === 0;
    };
    reader.readAsText(file);
  });

  importBtn.addEventListener('click', async () => {
    const valid = parsedMembers.filter((m) => m.firstName && m.lastName);
    if (!valid.length) return;
    importBtn.disabled = true;
    importBtn.textContent = 'Importing…';
    try {
      const result = await api.post('/api/members/bulk', { branchId: currentBranchId, members: valid });
      backdrop.remove();
      const branchNote = result.branchesTouched && result.branchesTouched.length > 1
        ? ` across ${result.branchesTouched.length} branches`
        : '';
      toast(`Imported ${result.createdCount} member${result.createdCount === 1 ? '' : 's'}${branchNote}${result.skipped.length ? ` (${result.skipped.length} skipped)` : ''}`);
      await loadBranches();
      loadMembersTable();
    } catch (e) {
      toast(e.message, true);
      importBtn.disabled = false;
      importBtn.textContent = 'Import';
    }
  });
}

// ---------------- Sessions (Services) ----------------
async function renderSessions() {
  const currentBranch = branches.find((b) => b.id === currentBranchId);
  main.innerHTML = `<div class="page-header">
      <div><h2>Services</h2><p>${currentBranch ? escapeHtml(currentBranch.name) : ''} — dated services and events you can take attendance for.</p></div>
      <button class="btn-brass" id="add-session-btn">+ New service</button>
    </div>
    <div class="card"><div id="sessions-table"></div></div>`;
  document.getElementById('add-session-btn').addEventListener('click', openSessionModal);
  await loadSessionsTable();
}

async function loadSessionsTable() {
  const target = document.getElementById('sessions-table');
  target.innerHTML = 'Loading…';
  const sessions = await api.get(`/api/sessions?branchId=${currentBranchId}`);
  if (!sessions.length) {
    target.innerHTML = `<div class="empty-state"><div class="glyph">◇</div>No services logged yet.</div>`;
    return;
  }
  target.innerHTML = `<table>
    <thead><tr><th>Service</th><th>Type</th><th>Date</th><th>Attendance</th><th></th></tr></thead>
    <tbody>${sessions.map((s) => `
      <tr>
        <td><strong>${escapeHtml(s.title)}</strong></td>
        <td>${escapeHtml(s.type)}</td>
        <td>${fmtDate(s.date)}</td>
        <td><span class="badge-count">${s.attendanceCount}</span></td>
        <td style="text-align:right;">
          <a href="/api/sessions/${s.id}/export" class="btn-ghost btn-sm" style="text-decoration:none; display:inline-block;">Export CSV</a>
          <button class="btn-danger btn-sm" onclick="deleteSession(${s.id})">Delete</button>
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
}

function openSessionModal() {
  const today = new Date().toISOString().slice(0, 10);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h3>New service</h3>
      <div class="field"><label>Title</label><input id="s-title" placeholder="e.g. Sunday Morning Service" /></div>
      <div class="field-row">
        <div class="field"><label>Type</label>
          <select id="s-type">
            <option>Sunday Service</option>
            <option>Bible Study</option>
            <option>Prayer Meeting</option>
            <option>Youth Service</option>
            <option>Special Event</option>
          </select>
        </div>
        <div class="field"><label>Date</label><input id="s-date" type="date" value="${today}" /></div>
      </div>
      <div class="field"><label>Notes (optional)</label><input id="s-notes" /></div>
      <div class="modal-actions">
        <button class="btn-ghost" id="s-cancel">Cancel</button>
        <button class="btn-primary" id="s-save">Create service</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#s-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#s-save').addEventListener('click', async () => {
    const payload = {
      title: backdrop.querySelector('#s-title').value.trim(),
      type: backdrop.querySelector('#s-type').value,
      date: backdrop.querySelector('#s-date').value,
      notes: backdrop.querySelector('#s-notes').value.trim(),
      branchId: currentBranchId
    };
    if (!payload.title || !payload.date) { toast('Title and date are required', true); return; }
    try {
      await api.post('/api/sessions', payload);
      backdrop.remove();
      toast('Service created');
      loadSessionsTable();
    } catch (e) { toast(e.message, true); }
  });
}

async function deleteSession(id) {
  if (!confirm('Delete this service and all its attendance records?')) return;
  try {
    await api.del(`/api/sessions/${id}`);
    toast('Service deleted');
    loadSessionsTable();
  } catch (e) { toast(e.message, true); }
}

// ---------------- Check-in ----------------
async function renderCheckin() {
  const currentBranch = branches.find((b) => b.id === currentBranchId);
  main.innerHTML = `<div class="page-header"><div><h2>Check-in</h2><p>${currentBranch ? escapeHtml(currentBranch.name) : ''} — select a service, then search or add a visitor to record attendance.</p></div></div>
    <div id="checkin-content">Loading…</div>`;
  const sessions = await api.get(`/api/sessions?branchId=${currentBranchId}`);
  const content = document.getElementById('checkin-content');
  if (!sessions.length) {
    content.innerHTML = `<div class="empty-state"><div class="glyph">◇</div>No services yet for this branch. Create one under "Services" first.</div>`;
    return;
  }
  content.innerHTML = `
    <div class="session-picker">
      <label>Service</label>
      <select id="ci-session">
        ${sessions.map((s) => `<option value="${s.id}">${escapeHtml(s.title)} — ${fmtDate(s.date)}</option>`).join('')}
      </select>
    </div>
    <div class="checkin-layout">
      <div>
        <div class="checkin-search">
          <label>Search members</label>
          <input id="ci-search" placeholder="Type a name…" autocomplete="off" />
        </div>
        <div class="checkin-results" id="ci-results"></div>
        <div class="card" style="margin-top:16px; padding:16px 20px;">
          <label>Or check in a visitor / walk-in</label>
          <div style="display:flex; gap:8px; margin-top:6px;">
            <input id="ci-visitor-name" placeholder="Visitor's full name" />
            <button class="btn-brass" id="ci-visitor-btn" style="flex-shrink:0;">Check in</button>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Checked in <span class="badge-count" id="ci-count">0</span></h3></div>
        <div id="ci-attendance-list"></div>
      </div>
    </div>`;

  let allMembers = await api.get(`/api/members?branchId=${currentBranchId}`);
  const sessionSelect = document.getElementById('ci-session');
  sessionSelect.addEventListener('change', refreshAttendanceList);

  document.getElementById('ci-search').addEventListener('input', (e) => renderMemberResults(e.target.value));
  document.getElementById('ci-visitor-btn').addEventListener('click', async () => {
    const name = document.getElementById('ci-visitor-name').value.trim();
    if (!name) { toast('Enter a visitor name', true); return; }
    await checkInPerson({ visitorName: name });
    document.getElementById('ci-visitor-name').value = '';
  });

  function renderMemberResults(query) {
    const results = document.getElementById('ci-results');
    if (!query.trim()) { results.innerHTML = ''; return; }
    const q = query.toLowerCase();
    const matches = allMembers.filter((m) => (`${m.firstName} ${m.lastName}`).toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { results.innerHTML = `<p style="color:var(--ink-soft); font-size:13.5px;">No members match "${escapeHtml(query)}".</p>`; return; }
    results.innerHTML = matches.map((m) => `
      <div class="checkin-row">
        <div>
          <div class="who">${escapeHtml(m.firstName)} ${escapeHtml(m.lastName)}</div>
          <div class="meta">${escapeHtml(m.group)} · ${escapeHtml(m.category)}</div>
        </div>
        <button class="stamp-btn btn-sm" onclick="window.__checkInMember(${m.id})">Check in</button>
      </div>`).join('');
  }

  window.__checkInMember = async (memberId) => { await checkInPerson({ memberId }); };

  async function checkInPerson(payload) {
    const sessionId = sessionSelect.value;
    try {
      await api.post(`/api/sessions/${sessionId}/attendance`, payload);
      toast('Checked in');
      document.getElementById('ci-search').value = '';
      document.getElementById('ci-results').innerHTML = '';
      refreshAttendanceList();
    } catch (e) { toast(e.message, true); }
  }

  async function refreshAttendanceList() {
    const sessionId = sessionSelect.value;
    const records = await api.get(`/api/sessions/${sessionId}/attendance`);
    document.getElementById('ci-count').textContent = records.length;
    const listEl = document.getElementById('ci-attendance-list');
    if (!records.length) {
      listEl.innerHTML = `<div class="empty-state"><div class="glyph">◇</div>No check-ins yet for this service.</div>`;
      return;
    }
    listEl.innerHTML = `<table>
      <tbody>${records.map((r) => `
        <tr>
          <td><strong>${escapeHtml(r.displayName)}</strong> ${r.isVisitor ? '<span class="tag visitor">Visitor</span>' : ''}</td>
          <td style="color:var(--ink-soft); text-align:right;">${fmtTime(r.checkedInAt)}</td>
          <td style="text-align:right; width:1%;"><button class="btn-danger btn-sm" onclick="removeAttendance(${r.id})">Undo</button></td>
        </tr>`).join('')}</tbody></table>`;
  }

  window.removeAttendance = async (id) => {
    try { await api.del(`/api/attendance/${id}`); refreshAttendanceList(); } catch (e) { toast(e.message, true); }
  };

  refreshAttendanceList();
}

// ---------------- Branches management ----------------
async function renderBranches() {
  main.innerHTML = `<div class="page-header">
      <div><h2>Branches</h2><p>Each branch keeps its own members, services, and reports — switch between them from the sidebar.</p></div>
      <button class="btn-brass" id="add-branch-btn">+ New branch</button>
    </div>
    <div class="card"><div id="branches-table"></div></div>`;
  document.getElementById('add-branch-btn').addEventListener('click', () => openBranchModal());
  await loadBranchesTable();
}

async function loadBranchesTable() {
  const target = document.getElementById('branches-table');
  target.innerHTML = 'Loading…';
  const list = await api.get('/api/branches');
  target.innerHTML = `<table>
    <thead><tr><th>Branch</th><th>Location</th><th>Members</th><th>Services</th><th></th></tr></thead>
    <tbody>${list.map((b) => `
      <tr>
        <td><strong>${escapeHtml(b.name)}</strong></td>
        <td>${escapeHtml(b.location || '—')}</td>
        <td>${b.memberCount}</td>
        <td>${b.sessionCount}</td>
        <td style="text-align:right;">
          <button class="btn-ghost btn-sm" onclick="openBranchModal(${b.id})">Edit</button>
          <button class="btn-danger btn-sm" onclick="deleteBranch(${b.id})">Delete</button>
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
}

async function openBranchModal(id) {
  const list = id ? await api.get('/api/branches') : [];
  const branch = id ? list.find((b) => b.id === id) : null;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h3>${branch ? 'Edit branch' : 'New branch'}</h3>
      <div class="field"><label>Branch name</label><input id="b-name" placeholder="e.g. Kumasi Branch" value="${branch ? escapeHtml(branch.name) : ''}" /></div>
      <div class="field"><label>Location (optional)</label><input id="b-location" placeholder="e.g. Kumasi, Ghana" value="${branch ? escapeHtml(branch.location) : ''}" /></div>
      <div class="modal-actions">
        <button class="btn-ghost" id="b-cancel">Cancel</button>
        <button class="btn-primary" id="b-save">${branch ? 'Save changes' : 'Create branch'}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#b-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#b-save').addEventListener('click', async () => {
    const payload = {
      name: backdrop.querySelector('#b-name').value.trim(),
      location: backdrop.querySelector('#b-location').value.trim()
    };
    if (!payload.name) { toast('Branch name is required', true); return; }
    try {
      if (branch) await api.put(`/api/branches/${branch.id}`, payload);
      else await api.post('/api/branches', payload);
      backdrop.remove();
      toast(branch ? 'Branch updated' : 'Branch created');
      await loadBranches();
      loadBranchesTable();
    } catch (e) { toast(e.message, true); }
  });
}

async function deleteBranch(id) {
  if (!confirm('Delete this branch? It must have no members or services.')) return;
  try {
    await api.del(`/api/branches/${id}`);
    toast('Branch deleted');
    await loadBranches();
    loadBranchesTable();
  } catch (e) { toast(e.message, true); }
}

checkAuth();
