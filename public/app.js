// app.js — frontend for Cupid Agents
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const esc = s => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const initials = n => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const scoreColor = s => s >= 75 ? 'background:#1d3a24;color:#8fcf9a' : s >= 50 ? 'background:#3a3416;color:#e3cf7a' : 'background:#3a1a1c;color:#e0908a';

let DATA = { people: [], rankings: {}, dates: {} };

// ---------- tabs ----------
$$('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));
function showView(v) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
}

// ---------- bulk parsing ----------
function parsePeople() {
  return $('#bulk').value.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const parts = line.split('|').map(s => s.trim());
    const urls = parts.filter(p => /^https?:\/\//i.test(p));
    const name = parts.find(p => !/^https?:\/\//i.test(p)) || '';
    const linkedin = urls.find(u => /linkedin\.com/i.test(u)) || '';
    const instagram = urls.find(u => /instagram\.com/i.test(u)) || '';
    return { name, linkedin, instagram };
  }).filter(p => p.linkedin || p.instagram);
}
$('#bulk').addEventListener('input', () => {
  const n = parsePeople().length;
  $('#countHint').textContent = `${n} people`;
});

// ---------- health ----------
fetch('/api/health').then(r => r.json()).then(h => {
  const pill = $('#providerPill');
  pill.textContent = h.provider === 'none' ? '⚠️ no API key' : `LLM: ${h.provider}`;
  pill.style.color = h.provider === 'none' ? 'var(--rose)' : 'var(--gold)';
}).catch(() => {});

// ---------- load existing state ----------
fetch('/api/state').then(r => r.json()).then(s => {
  if (s && s.people && s.people.length) {
    DATA = s;
    renderAll();
  }
}).catch(() => {});

// ---------- sample data ----------
const SAMPLE = [
  'Sundar Pichai | https://www.linkedin.com/in/sundarpichai | https://www.instagram.com/sundarpichai',
  'Bill Gates | https://www.linkedin.com/in/williamhgates | https://www.instagram.com/thisisbillgates',
  'Arianna Huffington | https://www.linkedin.com/in/ariannahuffington | https://www.instagram.com/ariannahuff',
  'Richard Branson | https://www.linkedin.com/in/rbranson | https://www.instagram.com/richardbranson',
  'Gary Vaynerchuk | https://www.linkedin.com/in/garyvaynerchuk | https://www.instagram.com/garyvee',
  'Reid Hoffman | https://www.linkedin.com/in/reidhoffman | https://www.instagram.com/reidhoffman',
  'Melinda French Gates | https://www.linkedin.com/in/melindagates | https://www.instagram.com/melindafrenchgates',
  'Satya Nadella | https://www.linkedin.com/in/satyanadella | https://www.instagram.com/satyanadella',
  'Sheryl Sandberg | https://www.linkedin.com/in/sheryl-sandberg | https://www.instagram.com/sherylsandberg',
  'Marc Benioff | https://www.linkedin.com/in/marcbenioff | https://www.instagram.com/marcbenioff',
  'Whitney Wolfe Herd | https://www.linkedin.com/in/whitney-wolfe-herd | https://www.instagram.com/whitney',
  'Neil Patel | https://www.linkedin.com/in/neilkpatel | https://www.instagram.com/neilpatel',
  'Mark Cuban | https://www.linkedin.com/in/mark-cuban | https://www.instagram.com/mcuban',
  'Jay Shetty | https://www.linkedin.com/in/jayshetty | https://www.instagram.com/jayshetty',
  'Tim Ferriss | https://www.linkedin.com/in/timferriss | https://www.instagram.com/timferriss',
  'Simon Sinek | https://www.linkedin.com/in/simonsinek | https://www.instagram.com/simonsinek',
  'Mel Robbins | https://www.linkedin.com/in/melrobbins | https://www.instagram.com/melrobbins',
  'Steven Bartlett | https://www.linkedin.com/in/stevenbartlett-123 | https://www.instagram.com/steven',
  'Daymond John | https://www.linkedin.com/in/daymondjohn | https://www.instagram.com/thesharkdaymond',
  'Barbara Corcoran | https://www.linkedin.com/in/barbaracorcoran | https://www.instagram.com/barbaracorcoran',
  'Guy Kawasaki | https://www.linkedin.com/in/guykawasaki | https://www.instagram.com/guykawasaki',
  'Ann Handley | https://www.linkedin.com/in/annhandley | https://www.instagram.com/annhandley',
  'Seth Godin | https://www.linkedin.com/in/sethgodin | https://www.instagram.com/sethgodin',
  'Brene Brown | https://www.linkedin.com/in/brenebrown | https://www.instagram.com/brenebrown',
  'Lewis Howes | https://www.linkedin.com/in/lewishowes | https://www.instagram.com/lewishowes',
];
$('#loadSample').addEventListener('click', () => {
  $('#bulk').value = SAMPLE.join('\n');
  $('#bulk').dispatchEvent(new Event('input'));
});

// ---------- run pipeline (NDJSON stream) ----------
const phaseTotals = { scrape: 0, analyze: 0, rank: 0, date: 0 };
const phaseDone = { scrape: 0, analyze: 0, rank: 0, date: 0 };
function setBar(phase) {
  const total = phaseTotals[phase] || 1;
  const pct = Math.min(100, Math.round((phaseDone[phase] / total) * 100));
  const el = $('#bar-' + phase);
  if (el) el.style.width = pct + '%';
}
function logLine(msg, cls = '') {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = msg;
  $('#log').appendChild(d);
  $('#log').scrollTop = $('#log').scrollHeight;
}

$('#runBtn').addEventListener('click', async () => {
  const people = parsePeople();
  if (!people.length) { alert('Add at least one person (with a LinkedIn or Instagram URL).'); return; }

  $('#runBtn').disabled = true;
  $('#progressCard').classList.remove('hidden');
  $('#log').innerHTML = '';
  DATA = { people: [], rankings: {}, dates: {} };
  Object.keys(phaseTotals).forEach(k => { phaseTotals[k] = people.length; phaseDone[k] = 0; setBar(k); });
  phaseTotals.date = Math.max(1, Math.ceil(people.length / 2));

  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ people }),
    });
    if (!res.ok) { logLine('Error: ' + (await res.text()), 'warn'); $('#runBtn').disabled = false; return; }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (line.trim()) handleEvent(JSON.parse(line));
      }
    }
    logLine('✓ Done.', 'ok');
    showView('profiles');
  } catch (e) {
    logLine('Stream error: ' + e.message, 'warn');
  }
  $('#runBtn').disabled = false;
});

function handleEvent(ev) {
  if (ev.type === 'start') {
    logLine(`Starting run for ${ev.count} people via ${ev.provider}…`);
  } else if (ev.type === 'phase') {
    if (ev.status === 'done' && ev.phase === 'scrape') {
      phaseDone.scrape++; setBar('scrape');
      logLine(`scraped ${ev.name} — LinkedIn:${ev.linkedin ? 'ok' : 'thin'} Instagram:${ev.instagram ? 'ok' : 'thin'}`, (ev.linkedin || ev.instagram) ? 'ok' : 'warn');
    } else if (ev.status === 'working' && ev.phase === 'date') {
      logLine(`💞 date: ${ev.name}`);
    }
  } else if (ev.type === 'profile') {
    phaseDone.analyze++; setBar('analyze');
    DATA.people.push({ id: ev.id, name: ev.name, linkedin: ev.linkedin, instagram: ev.instagram, profile: ev.profile });
    logLine(`analyzed ${ev.profile.displayName}`, 'ok');
    renderProfiles(); fillSelects();
  } else if (ev.type === 'rankings') {
    phaseDone.rank++; setBar('rank');
    DATA.rankings[ev.id] = ev.rankings;
    renderRankings();
  } else if (ev.type === 'datePlan') {
    phaseTotals.date = Math.max(1, ev.count); phaseDone.date = 0; setBar('date');
  } else if (ev.type === 'date') {
    phaseDone.date++; setBar('date');
    DATA.dates[ev.key] = ev.date;
    renderDates();
  } else if (ev.type === 'done') {
    Object.keys(phaseTotals).forEach(k => { phaseDone[k] = phaseTotals[k]; setBar(k); });
  }
}

// ---------- rendering ----------
function renderAll() { renderProfiles(); renderRankings(); renderDates(); fillSelects(); }

function renderProfiles() {
  const grid = $('#profilesGrid');
  $('#profilesCount').textContent = DATA.people.length ? `${DATA.people.length} people` : '';
  if (!DATA.people.length) { grid.innerHTML = '<p class="empty">No profiles yet — run the agents from the Input tab.</p>'; return; }
  grid.innerHTML = DATA.people.map(p => {
    const pr = p.profile || {};
    const tags = (pr.interests || []).slice(0, 3);
    return `<div class="pcard" data-id="${p.id}">
      <span class="vibe">${esc(pr.vibe || '')}</span>
      <div class="avatar">${initials(pr.displayName || p.name)}</div>
      <h3>${esc(pr.displayName || p.name)}</h3>
      <div class="tagline">${esc(pr.tagline || '')}</div>
      <div class="chips">${tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
    </div>`;
  }).join('');
  $$('.pcard').forEach(c => c.addEventListener('click', () => openProfile(c.dataset.id)));
}

function openProfile(id) {
  const p = DATA.people.find(x => x.id === id);
  if (!p) return;
  const pr = p.profile || {};
  const list = arr => (arr && arr.length) ? `<div class="chips">${arr.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : '<span class="muted">—</span>';
  const topMatch = (DATA.rankings[id] || [])[0];
  $('#modalBody').innerHTML = `
    <span class="close" id="closeModal">✕</span>
    <h2>${esc(pr.displayName || p.name)}</h2>
    <div class="tagline">${esc(pr.tagline || '')}</div>
    <div class="links">
      ${p.linkedin ? `<a href="${esc(p.linkedin)}" target="_blank">LinkedIn ↗</a>` : ''}
      ${p.instagram ? `<a href="${esc(p.instagram)}" target="_blank">Instagram ↗</a>` : ''}
    </div>
    <div class="block"><p>${esc(pr.summary || '')}</p></div>
    <div class="block"><h4>Needs</h4>${list(pr.needs)}</div>
    <div class="block"><h4>Hobbies</h4>${list(pr.hobbies)}</div>
    <div class="block"><h4>Interests</h4>${list(pr.interests)}</div>
    <div class="block"><h4>Qualities</h4>${list(pr.qualities)}</div>
    <div class="block"><h4>Green flags</h4>${list(pr.greenFlags)}</div>
    <div class="block"><h4>Looking for</h4><p>${esc(pr.lookingFor || '')}</p></div>
    <div class="block"><h4>Dating style</h4><p>${esc(pr.datingStyle || '')}</p></div>
    ${topMatch ? `<div class="block"><h4>Best match</h4><p><b style="color:var(--gold-bright)">${esc(topMatch.name)}</b> · <span style="color:var(--green)">${topMatch.score}%</span> — ${esc(topMatch.reason)}</p></div>` : ''}
  `;
  $('#modal').classList.add('open');
  $('#closeModal').addEventListener('click', closeModal);
}
function closeModal() { $('#modal').classList.remove('open'); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

function renderRankings() {
  const el = $('#rankingsList');
  if (!DATA.people.length || !Object.keys(DATA.rankings).length) { el.innerHTML = '<p class="empty">No rankings yet.</p>'; return; }
  el.innerHTML = DATA.people.map(p => {
    const ranks = (DATA.rankings[p.id] || []).slice(0, 6);
    if (!ranks.length) return '';
    const rows = ranks.map((r, i) => `
      <div class="rank-row">
        <span class="rank-pos">${i + 1}</span>
        <span class="rank-name">${esc(r.name)}</span>
        <span class="rank-reason">${esc(r.reason)}</span>
        <span class="rank-score" style="${scoreColor(r.score)}">${r.score}%</span>
        <button class="btn" data-a="${p.id}" data-b="${r.id}">date</button>
      </div>`).join('');
    return `<div class="rank-block"><h3>${esc(p.profile?.displayName || p.name)}</h3>
      <p class="muted">Ranked best fit first</p>${rows}</div>`;
  }).join('');
  $$('#rankingsList .btn').forEach(b => b.addEventListener('click', () => startDate(b.dataset.a, b.dataset.b)));
}

function renderDates() {
  const el = $('#datesList');
  $('#arenaControls').classList.toggle('hidden', !DATA.people.length);
  const keys = Object.keys(DATA.dates);
  if (!keys.length) { el.innerHTML = '<p class="empty">No dates yet. Pick two people above and send them on a date.</p>'; return; }
  el.innerHTML = keys.map(k => dateCard(DATA.dates[k])).join('');
}

function dateCard(d) {
  const chat = (d.transcript || []).map(t => {
    const who = t.speaker === 'A' ? d.aName : d.bName;
    return `<div class="bubble ${t.speaker === 'A' ? 'A' : 'B'}"><span class="who">${esc(who)}</span>${esc(t.text)}</div>`;
  }).join('');
  const reasons = (d.reasons || []).map(r => `<span class="chip">${esc(r)}</span>`).join('');
  return `<div class="date-card">
    <div class="date-head">
      <span class="pair">${esc(d.aName)} <span style="color:var(--rose)">✕</span> ${esc(d.bName)}</span>
      <span class="score-badge" style="${scoreColor(d.score)}">${d.score}% match</span>
    </div>
    <div class="verdict">“${esc(d.verdict || '')}”</div>
    <div class="chat">${chat}</div>
    <div class="reasons">${reasons}</div>
  </div>`;
}

function fillSelects() {
  const opts = DATA.people.map(p => `<option value="${p.id}">${esc(p.profile?.displayName || p.name)}</option>`).join('');
  $('#selA').innerHTML = opts;
  $('#selB').innerHTML = opts;
  if (DATA.people.length > 1) $('#selB').selectedIndex = 1;
}
$('#goDate').addEventListener('click', () => startDate($('#selA').value, $('#selB').value));

async function startDate(aId, bId) {
  if (aId === bId) { alert('Pick two different people.'); return; }
  showView('arena');
  const key = [aId, bId].sort().join('__');
  if (DATA.dates[key]) { renderDates(); window.scrollTo(0, 0); return; }
  $('#datesList').insertAdjacentHTML('afterbegin', `<p class="empty" id="dating-wait">💘 The agents are on their date…</p>`);
  try {
    const res = await fetch('/api/date', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aId, bId }) });
    const d = await res.json();
    if (d.error) { alert(d.error); } else { DATA.dates[key] = d; }
  } catch (e) { alert('Date failed: ' + e.message); }
  renderDates();
}
