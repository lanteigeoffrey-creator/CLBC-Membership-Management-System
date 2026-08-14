require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const { load, save, nextId } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(cors());
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
      secure: process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY === 'true'
    }
  })
);
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// ---------- AUTH ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const data = load();
  const user = data.users.find((u) => u.username === username);
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ id: user.id, username: user.username, role: user.role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ id: req.session.userId, username: req.session.username });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const data = load();
  const user = data.users.find((u) => u.id === req.session.userId);
  if (!bcrypt.compareSync(currentPassword || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  user.passwordHash = bcrypt.hashSync(newPassword, 8);
  save(data);
  res.json({ ok: true });
});

// ---------- BRANCHES ----------
app.get('/api/branches', requireAuth, (req, res) => {
  const data = load();
  const withCounts = data.branches.map((b) => ({
    ...b,
    memberCount: data.members.filter((m) => m.branchId === b.id).length,
    sessionCount: data.sessions.filter((s) => s.branchId === b.id).length
  }));
  res.json(withCounts);
});

app.post('/api/branches', requireAuth, (req, res) => {
  const { name, location } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Branch name is required' });
  const data = load();
  if (data.branches.some((b) => b.name.toLowerCase() === name.trim().toLowerCase())) {
    return res.status(409).json({ error: 'A branch with that name already exists' });
  }
  const branch = {
    id: nextId(data, 'branches'),
    name: name.trim(),
    location: location || '',
    createdAt: new Date().toISOString()
  };
  data.branches.push(branch);
  save(data);
  res.status(201).json(branch);
});

app.put('/api/branches/:id', requireAuth, (req, res) => {
  const data = load();
  const branch = data.branches.find((b) => b.id === Number(req.params.id));
  if (!branch) return res.status(404).json({ error: 'Branch not found' });
  const { name, location } = req.body;
  if (name) branch.name = name.trim();
  if (location !== undefined) branch.location = location;
  save(data);
  res.json(branch);
});

app.delete('/api/branches/:id', requireAuth, (req, res) => {
  const data = load();
  const id = Number(req.params.id);
  if (data.branches.length <= 1) {
    return res.status(400).json({ error: 'At least one branch must remain' });
  }
  const hasMembers = data.members.some((m) => m.branchId === id);
  const hasSessions = data.sessions.some((s) => s.branchId === id);
  if (hasMembers || hasSessions) {
    return res.status(409).json({ error: 'Move or delete this branch\'s members and services first' });
  }
  const idx = data.branches.findIndex((b) => b.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Branch not found' });
  data.branches.splice(idx, 1);
  save(data);
  res.json({ ok: true });
});

// ---------- MEMBERS ----------
app.get('/api/members', requireAuth, (req, res) => {
  const data = load();
  let members = data.members;
  if (req.query.branchId) members = members.filter((m) => m.branchId === Number(req.query.branchId));
  res.json(members.sort((a, b) => a.firstName.localeCompare(b.firstName)));
});

app.post('/api/members', requireAuth, (req, res) => {
  const { firstName, lastName, email, phone, group, category, notes, branchId } = req.body;
  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'First and last name are required' });
  }
  const data = load();
  const resolvedBranchId = branchId ? Number(branchId) : data.branches[0].id;
  if (!data.branches.some((b) => b.id === resolvedBranchId)) {
    return res.status(400).json({ error: 'Invalid branch' });
  }
  const member = {
    id: nextId(data, 'members'),
    branchId: resolvedBranchId,
    firstName,
    lastName,
    email: email || '',
    phone: phone || '',
    group: group || 'General',
    category: category || 'Member', // Member | Visitor | Volunteer
    notes: notes || '',
    active: true,
    createdAt: new Date().toISOString()
  };
  data.members.push(member);
  save(data);
  res.status(201).json(member);
});

// Bulk import — accepts { branchId, members: [{ firstName, lastName, email, phone, group, category }, ...] }
app.post('/api/members/bulk', requireAuth, (req, res) => {
  const { branchId, members } = req.body;
  if (!Array.isArray(members) || !members.length) {
    return res.status(400).json({ error: 'No members provided' });
  }
  const data = load();
  const resolvedBranchId = branchId ? Number(branchId) : data.branches[0].id;
  if (!data.branches.some((b) => b.id === resolvedBranchId)) {
    return res.status(400).json({ error: 'Invalid branch' });
  }
  const created = [];
  const skipped = [];
  members.forEach((row, i) => {
    const firstName = (row.firstName || '').trim();
    const lastName = (row.lastName || '').trim();
    if (!firstName || !lastName) {
      skipped.push({ row: i + 1, reason: 'Missing first or last name' });
      return;
    }
    const member = {
      id: nextId(data, 'members'),
      branchId: resolvedBranchId,
      firstName,
      lastName,
      email: (row.email || '').trim(),
      phone: (row.phone || '').trim(),
      group: (row.group || '').trim() || 'General',
      category: ['Member', 'Volunteer', 'Visitor'].includes(row.category) ? row.category : 'Member',
      notes: '',
      active: true,
      createdAt: new Date().toISOString()
    };
    data.members.push(member);
    created.push(member);
  });
  save(data);
  res.status(201).json({ createdCount: created.length, skipped });
});

app.put('/api/members/:id', requireAuth, (req, res) => {
  const data = load();
  const member = data.members.find((m) => m.id === Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'Member not found' });
  Object.assign(member, req.body, { id: member.id });
  save(data);
  res.json(member);
});

app.delete('/api/members/:id', requireAuth, (req, res) => {
  const data = load();
  const idx = data.members.findIndex((m) => m.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Member not found' });
  data.members.splice(idx, 1);
  save(data);
  res.json({ ok: true });
});

// ---------- SESSIONS (a service/event instance, e.g. "Sunday Service - 2026-08-16") ----------
app.get('/api/sessions', requireAuth, (req, res) => {
  const data = load();
  let sessions = data.sessions;
  if (req.query.branchId) sessions = sessions.filter((s) => s.branchId === Number(req.query.branchId));
  const withCounts = sessions
    .map((s) => ({
      ...s,
      attendanceCount: data.attendance.filter((a) => a.sessionId === s.id).length
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(withCounts);
});

app.post('/api/sessions', requireAuth, (req, res) => {
  const { title, type, date, notes, branchId } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'Title and date are required' });
  const data = load();
  const resolvedBranchId = branchId ? Number(branchId) : data.branches[0].id;
  if (!data.branches.some((b) => b.id === resolvedBranchId)) {
    return res.status(400).json({ error: 'Invalid branch' });
  }
  const sessionObj = {
    id: nextId(data, 'sessions'),
    branchId: resolvedBranchId,
    title,
    type: type || 'Sunday Service',
    date,
    notes: notes || '',
    createdAt: new Date().toISOString()
  };
  data.sessions.push(sessionObj);
  save(data);
  res.status(201).json(sessionObj);
});

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const data = load();
  const idx = data.sessions.findIndex((s) => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Session not found' });
  data.sessions.splice(idx, 1);
  data.attendance = data.attendance.filter((a) => a.sessionId !== Number(req.params.id));
  save(data);
  res.json({ ok: true });
});

// ---------- ATTENDANCE / CHECK-IN ----------
app.get('/api/sessions/:id/attendance', requireAuth, (req, res) => {
  const data = load();
  const sessionId = Number(req.params.id);
  const records = data.attendance
    .filter((a) => a.sessionId === sessionId)
    .map((a) => {
      const member = a.memberId ? data.members.find((m) => m.id === a.memberId) : null;
      return {
        ...a,
        displayName: member ? `${member.firstName} ${member.lastName}` : a.visitorName,
        isVisitor: !a.memberId
      };
    })
    .sort((a, b) => new Date(b.checkedInAt) - new Date(a.checkedInAt));
  res.json(records);
});

app.post('/api/sessions/:id/attendance', requireAuth, (req, res) => {
  const sessionId = Number(req.params.id);
  const { memberId, visitorName } = req.body;
  const data = load();
  const sessionExists = data.sessions.find((s) => s.id === sessionId);
  if (!sessionExists) return res.status(404).json({ error: 'Session not found' });
  if (!memberId && !visitorName) {
    return res.status(400).json({ error: 'memberId or visitorName is required' });
  }
  if (memberId) {
    const already = data.attendance.find((a) => a.sessionId === sessionId && a.memberId === memberId);
    if (already) return res.status(409).json({ error: 'Member already checked in for this session' });
  }
  const record = {
    id: nextId(data, 'attendance'),
    sessionId,
    memberId: memberId || null,
    visitorName: memberId ? null : visitorName,
    checkedInAt: new Date().toISOString()
  };
  data.attendance.push(record);
  save(data);
  res.status(201).json(record);
});

app.delete('/api/attendance/:id', requireAuth, (req, res) => {
  const data = load();
  const idx = data.attendance.findIndex((a) => a.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Record not found' });
  data.attendance.splice(idx, 1);
  save(data);
  res.json({ ok: true });
});

// ---------- DASHBOARD ----------
// Pass ?branchId=<id> for one branch's report, or ?branchId=all for a combined
// report across every branch (with a per-branch breakdown included).
app.get('/api/dashboard/stats', requireAuth, (req, res) => {
  const data = load();
  const branchParam = req.query.branchId;
  const isAll = !branchParam || branchParam === 'all';

  function statsFor(members, sessions, attendance) {
    const totalMembers = members.filter((m) => m.category !== 'Visitor').length;
    const totalVisitorsAllTime = new Set(
      attendance.filter((a) => !a.memberId).map((a) => a.visitorName)
    ).size;
    const sortedSessions = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
    const trend = sortedSessions.slice(-8).map((s) => ({
      title: s.title,
      date: s.date,
      count: attendance.filter((a) => a.sessionId === s.id).length
    }));
    const groupCounts = {};
    members.forEach((m) => { groupCounts[m.group] = (groupCounts[m.group] || 0) + 1; });
    const lastSession = sortedSessions[sortedSessions.length - 1];
    const lastSessionAttendance = lastSession
      ? attendance.filter((a) => a.sessionId === lastSession.id).length
      : 0;
    return {
      totalMembers,
      totalSessions: sessions.length,
      totalVisitorsAllTime,
      lastSession: lastSession ? { title: lastSession.title, date: lastSession.date, count: lastSessionAttendance } : null,
      trend,
      groupCounts
    };
  }

  if (isAll) {
    const combined = statsFor(data.members, data.sessions, data.attendance);
    const byBranch = data.branches.map((b) => {
      const branchSessionIds = new Set(data.sessions.filter((s) => s.branchId === b.id).map((s) => s.id));
      return {
        branchId: b.id,
        branchName: b.name,
        ...statsFor(
          data.members.filter((m) => m.branchId === b.id),
          data.sessions.filter((s) => s.branchId === b.id),
          data.attendance.filter((a) => branchSessionIds.has(a.sessionId))
        )
      };
    });
    return res.json({ ...combined, isAll: true, byBranch });
  }

  const branchId = Number(branchParam);
  const branch = data.branches.find((b) => b.id === branchId);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });
  const sessionIds = new Set(data.sessions.filter((s) => s.branchId === branchId).map((s) => s.id));
  const result = statsFor(
    data.members.filter((m) => m.branchId === branchId),
    data.sessions.filter((s) => s.branchId === branchId),
    data.attendance.filter((a) => sessionIds.has(a.sessionId))
  );
  res.json({ ...result, isAll: false, branchName: branch.name });
});

// ---------- CSV EXPORT ----------
app.get('/api/sessions/:id/export', requireAuth, (req, res) => {
  const data = load();
  const sessionId = Number(req.params.id);
  const sessionObj = data.sessions.find((s) => s.id === sessionId);
  if (!sessionObj) return res.status(404).json({ error: 'Session not found' });

  const branch = data.branches.find((b) => b.id === sessionObj.branchId);
  const records = data.attendance.filter((a) => a.sessionId === sessionId);
  const rows = [['Branch', 'Name', 'Type', 'Checked In At']];
  records.forEach((a) => {
    const member = a.memberId ? data.members.find((m) => m.id === a.memberId) : null;
    rows.push([
      branch ? branch.name : '',
      member ? `${member.firstName} ${member.lastName}` : a.visitorName,
      member ? member.category : 'Visitor',
      a.checkedInAt
    ]);
  });
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${(branch ? branch.name + '-' : '')}${sessionObj.title}-${sessionObj.date}.csv"`);
  res.send(csv);
});

// Fallback to index.html for any non-API route (simple SPA)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Church Attendance app running on port ${PORT}`);
});
