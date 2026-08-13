# CLBC Registry — Church Attendance & Membership App

A lightweight church management app for recording attendance: members, services/events,
check-in (including walk-in visitors), a dashboard with an attendance trend chart, and
CSV export per service — branded for **Changed Life Baptist Church**, with support for
**multiple branches**, each keeping its own members, services, and attendance reports.

> Note on the brief: I wasn't able to load ministrycount.com's page (it returned an
> access-restricted response), so this isn't a copy of that product — it's an original
> build covering the same category of features (members, check-in, attendance tracking,
> reporting).

## Multi-branch support

- Every church branch/campus is its own **Branch** record, with its own members,
  services, and check-in data — one branch's roster never shows up in another's.
- The **sidebar branch switcher** controls which branch you're currently working in for
  Members, Services, and Check-in.
- The **Dashboard** can show either the selected branch's report or a **combined "All
  branches"** view with a per-branch breakdown table — handy for a head office comparing
  attendance across campuses.
- Manage branches from the **Branches** page (add, rename, delete). A branch can only be
  deleted once it has no members or services left.
- Everyone currently shares one login and can see every branch. If different branches
  need their own staff logins that can only see their own branch, that's a natural next
  step — see "Going to production" below.

## Tech stack (chosen so it's easy to host for free)

- **Backend:** Node.js + Express
- **Data storage:** a single JSON file on disk (`data/db.json`) — no native database
  drivers, so it installs cleanly on any free Node host without build failures. This is
  fine for a UAT/pilot with a handful of concurrent staff users. See "Going to
  production" below for upgrading to a real database once you're past UAT.
- **Frontend:** plain HTML/CSS/JS single-page app served by the same Express server
  (no separate frontend build/deploy needed) + Chart.js (via CDN) for the attendance
  chart.
- **Auth:** simple session-based login, one admin account seeded on first run.

## Project structure

```
church-attendance/
├── server.js          # Express app + all API routes
├── db.js               # JSON file data layer
├── package.json
├── .env.example
├── data/db.json         # created automatically on first run
└── public/
    ├── index.html
    ├── css/style.css
    ├── js/app.js
    └── assets/logo.png   # CLBC logo, used on the login screen and sidebar
```

## Run it locally

Requires Node.js 18+.

```bash
cd church-attendance
npm install
cp .env.example .env      # then edit values if you want
npm start
```

Visit `http://localhost:3000`. Default login: **admin / admin123** — change it
immediately from a real deployment (there's a "Change password" endpoint at
`POST /api/change-password`; wiring a settings-page button for it is a nice next step).

## Free hosting for UAT

You need a host that runs a persistent Node process (not a stateless serverless
function), because this app writes to a local JSON file. Render and Railway both fit
and have free/low-cost tiers well suited to UAT.

### Option A: Render (recommended — simplest free path)

1. Push this project to a **GitHub repository** (see "Getting it onto GitHub" below).
2. Go to https://render.com and sign up (free, no card required for the free web
   service tier).
3. Click **New → Web Service**, connect your GitHub account, and select the repo.
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Add environment variables under the "Environment" tab:
   - `SESSION_SECRET` → any long random string
   - `ADMIN_USERNAME` → your preferred admin username
   - `ADMIN_PASSWORD` → your preferred admin password
   - `NODE_ENV` → `production`
6. Click **Create Web Service**. Render builds and deploys automatically; you'll get a
   free URL like `https://your-app.onrender.com`.
7. **Free-tier caveat:** the free instance "sleeps" after 15 minutes of inactivity and
   takes ~30–50 seconds to wake on the next request — fine for UAT, mention it to
   testers so they're not confused by the first slow load. Also note the filesystem is
   **not persistent across redeploys** on the free tier — a redeploy resets
   `data/db.json`. That's acceptable for UAT (you're testing behavior, not storing
   permanent records); revisit storage before going live (see below).

### Option B: Railway

1. Push the project to GitHub.
2. Go to https://railway.app, sign up, and choose **New Project → Deploy from GitHub
   repo**.
3. Railway auto-detects Node and runs `npm install && npm start`.
4. Add the same environment variables as above under the Variables tab.
5. Railway gives you a free trial credit; generate a public domain from the service's
   **Settings → Networking → Generate Domain**.

### Option C: Fly.io

Good if you want the app to stay "warm" (no cold-start sleep) on a free allowance.
Requires the `flyctl` CLI: `fly launch` in the project folder, accept the Node
detection, then `fly deploy`. Set secrets with `fly secrets set SESSION_SECRET=... 
ADMIN_PASSWORD=...`.

### Getting it onto GitHub (needed for Options A & B)

```bash
cd church-attendance
git init
git add .
git commit -m "Initial commit — church attendance app"
gh repo create church-attendance --public --source=. --push
```

(No `gh` CLI? Create an empty repo on github.com, then `git remote add origin <url>`
and `git push -u origin main`.)

## Free domain / URL for UAT

You don't need a custom domain for UAT — the free `*.onrender.com` or
`*.up.railway.app` URL is enough for testers. If you want a nicer/branded URL for free:

- **Freenom-style free domains are unreliable now** — skip them.
- Instead, get a **free subdomain** from your host (already included above), or
- Register a cheap `.org`/`.church` domain later (~$10–20/yr) once you exit UAT, and
  point its DNS to your Render/Railway service (both support custom domains for free).

## Going to production (after UAT)

Once UAT is signed off and you're ready for real congregational data:

1. **Swap the JSON file store for a real database** — the easiest free-tier path is
   [Supabase](https://supabase.com) (free Postgres) or
   [Neon](https://neon.tech) (free serverless Postgres). Replace `db.js` with real
   SQL queries; the route logic in `server.js` stays almost identical since it's
   already organized around simple CRUD functions.
2. Move sessions to a persistent store too (e.g. `connect-pg-simple`) instead of
   Express's in-memory session store, so logins survive restarts/scaling.
3. Turn on HTTPS-only cookies (`cookie.secure = true`, already wired to
   `NODE_ENV=production` + a `TRUST_PROXY` flag in `server.js` — set
   `app.set('trust proxy', 1)` if you host behind a proxy like Render's).
4. Add role-based, per-branch accounts (e.g. a Kumasi Branch admin who can only see and
   manage Kumasi's data) instead of one shared admin account that sees every branch.
5. Consider a paid "always-on" tier so the app doesn't cold-start for live services.

## Feature summary

- **Branches:** create/rename/delete branches; each keeps fully separate members,
  services, and attendance.
- **Dashboard:** total members, services logged, last service attendance, visitor
  count, and an attendance trend chart — scoped to one branch, or combined across all
  branches with a per-branch breakdown.
- **Members:** add/edit/delete members with group/ministry, category (Member,
  Volunteer, Visitor), and contact info — scoped to the active branch.
- **Services:** create dated service/event entries (Sunday Service, Bible Study,
  Prayer Meeting, etc.), see attendance counts, export attendance to CSV (includes
  branch name), delete.
- **Check-in:** pick a service, search members by name and one-tap check them in, or
  register a walk-in visitor by name. Live checked-in list with undo.

## Adding new branches for other locations

1. Sign in, open **Branches** in the sidebar, and click **+ New branch**.
2. Give it a name (e.g. "Kumasi Branch", "Takoradi Branch") and optional location.
3. Switch to it from the sidebar branch dropdown, then add its members and log its
   services independently — nothing you enter there affects other branches.
4. Use the Dashboard's **All branches** toggle any time you want a combined report
   across every location.
