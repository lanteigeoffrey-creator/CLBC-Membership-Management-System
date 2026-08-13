// Lightweight file-based data store.
// Uses a single JSON file on disk — no native modules, so it builds
// cleanly on any free Node host (Render, Railway, Cyclic, Fly.io, etc.)
// NOTE: For real production use with many concurrent users, migrate
// this to Postgres/Supabase/MySQL (see README "Going to production").

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_FILE = path.join(__dirname, 'data', 'db.json');

function defaultData() {
  return {
    users: [
      {
        id: 1,
        username: process.env.ADMIN_USERNAME || 'admin',
        // default password: "admin123" — CHANGE THIS after first login
        passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 8),
        role: 'admin'
      }
    ],
    branches: [
      {
        id: 1,
        name: process.env.DEFAULT_BRANCH_NAME || 'Main Branch',
        location: '',
        createdAt: new Date().toISOString()
      }
    ],
    members: [],
    sessions: [],
    attendance: [],
    _seq: { branches: 1, members: 0, sessions: 0, attendance: 0 }
  };
}

function migrate(data) {
  // Backfill fields for data files created before branch support existed.
  if (!data.branches) {
    data.branches = [{ id: 1, name: 'Main Branch', location: '', createdAt: new Date().toISOString() }];
  }
  if (!data._seq.branches) data._seq.branches = data.branches.length;
  const defaultBranchId = data.branches[0].id;
  (data.members || []).forEach((m) => { if (!m.branchId) m.branchId = defaultBranchId; });
  (data.sessions || []).forEach((s) => { if (!s.branchId) s.branchId = defaultBranchId; });
  return data;
}

function load() {
  if (!fs.existsSync(DATA_FILE)) {
    save(defaultData());
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  try {
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.error('Corrupt data file, reinitializing.', e);
    const fresh = defaultData();
    save(fresh);
    return fresh;
  }
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function nextId(data, table) {
  data._seq[table] = (data._seq[table] || 0) + 1;
  return data._seq[table];
}

module.exports = { load, save, nextId, DATA_FILE };
