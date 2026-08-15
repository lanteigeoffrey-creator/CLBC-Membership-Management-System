function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

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
  return dt.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
}

const token = window.location.pathname.split('/checkin/')[1];
const card = document.getElementById('sc-card');

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

async function init() {
  if (!token) {
    card.innerHTML = `<div class="sc-error">Invalid check-in link.</div>`;
    return;
  }
  let sessionInfo;
  try {
    sessionInfo = await api('GET', `/api/public/sessions/${token}`);
  } catch (e) {
    card.innerHTML = `<div class="sc-error">${escapeHtml(e.message)}</div>`;
    return;
  }

  card.innerHTML = `
    <div class="sc-service">
      <h1>${escapeHtml(sessionInfo.title)}</h1>
      <p>${escapeHtml(sessionInfo.branchName)} · ${fmtDate(sessionInfo.date)}</p>
    </div>
    <div class="sc-search">
      <input id="sc-input" placeholder="Type your first or last name…" autocomplete="off" autofocus />
    </div>
    <div class="sc-results" id="sc-results"></div>
    <div class="sc-divider">or</div>
    <div class="sc-visitor">
      <input id="sc-visitor-name" placeholder="First time here? Enter your name" />
      <button id="sc-visitor-btn">Check in</button>
    </div>`;

  const input = document.getElementById('sc-input');
  const results = document.getElementById('sc-results');
  let debounceTimer;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ''; return; }
    debounceTimer = setTimeout(async () => {
      try {
        const matches = await api('GET', `/api/public/sessions/${token}/members?search=${encodeURIComponent(q)}`);
        if (!matches.length) {
          results.innerHTML = `<p style="color:var(--ink-soft); font-size:13.5px; text-align:center; padding:8px 0;">No match — try the visitor option below if you're new here.</p>`;
          return;
        }
        results.innerHTML = matches.map((m) => `
          <div class="sc-row">
            <div>
              <div class="who">${escapeHtml(m.firstName)} ${escapeHtml(m.lastName)}</div>
              <div class="meta">${escapeHtml(m.group || '')}</div>
            </div>
            <button onclick="doCheckIn({memberId:${m.id}})">Check in</button>
          </div>`).join('');
      } catch (e) { toast(e.message, true); }
    }, 250);
  });

  document.getElementById('sc-visitor-btn').addEventListener('click', () => {
    const name = document.getElementById('sc-visitor-name').value.trim();
    if (!name) { toast('Enter your name first', true); return; }
    doCheckIn({ visitorName: name });
  });

  window.doCheckIn = async (payload) => {
    try {
      const result = await api('POST', `/api/public/sessions/${token}/checkin`, payload);
      card.innerHTML = `
        <div class="sc-confirm">
          <div class="mark">✓</div>
          <h2>${result.alreadyCheckedIn ? "You're already checked in" : "You're checked in!"}</h2>
          <p>${escapeHtml(result.name)} — welcome${result.alreadyCheckedIn ? ' back' : ''}.</p>
        </div>
        <button class="btn-ghost sc-checkin-another" onclick="location.reload()">Check in someone else</button>`;
    } catch (e) {
      toast(e.message, true);
    }
  };
}

init();
