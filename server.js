// server.js — Express API + static site for the agent-dating app.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapePerson } from './scraper.js';
import { analyzePerson, runDate, rankLocally } from './agents.js';
import { PROVIDER } from './llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- state (in-memory, mirrored to disk) ----
let STATE = loadState();
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { people: [], rankings: {}, dates: {}, createdAt: null, provider: PROVIDER };
  }
}
function saveState() {
  STATE.provider = PROVIDER;
  fs.writeFileSync(STATE_FILE, JSON.stringify(STATE, null, 2));
}

// run async jobs with limited concurrency
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        results[i] = { error: String(e?.message || e) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

const dateKey = (a, b) => [a, b].sort().join('__');

app.get('/api/health', (req, res) => {
  res.json({ ok: true, provider: PROVIDER, hasData: STATE.people.length > 0 });
});

app.get('/api/state', (req, res) => {
  res.json(STATE);
});

// Main pipeline. Streams NDJSON progress events so the UI (and the demo video) can show live work.
app.post('/api/run', async (req, res) => {
  const people = Array.isArray(req.body?.people) ? req.body.people : [];
  if (!people.length) return res.status(400).json({ error: 'No people provided' });
  if (PROVIDER === 'none') return res.status(400).json({ error: 'No LLM API key configured on the server (.env).' });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  const send = obj => res.write(JSON.stringify(obj) + '\n');

  const roster = people.map((p, i) => ({
    id: 'p' + (i + 1),
    name: (p.name || '').trim(),
    linkedin: (p.linkedin || '').trim(),
    instagram: (p.instagram || '').trim(),
  }));

  send({ type: 'start', count: roster.length, provider: PROVIDER });

  // 1) scrape
  await pool(roster, 5, async person => {
    send({ type: 'phase', phase: 'scrape', id: person.id, name: person.name, status: 'working' });
    person.scraped = await scrapePerson({ linkedin: person.linkedin, instagram: person.instagram });
    const liOk = person.scraped.linkedin?.ok;
    const igOk = person.scraped.instagram?.ok;
    send({ type: 'phase', phase: 'scrape', id: person.id, name: person.name, status: 'done', linkedin: !!liOk, instagram: !!igOk });
    return person;
  });

  // 2) analyze (low concurrency — free tiers rate-limit)
  await pool(roster, 2, async person => {
    send({ type: 'phase', phase: 'analyze', id: person.id, name: person.name, status: 'working' });
    try {
      person.profile = await analyzePerson(person);
      if (!person.profile.displayName) person.profile.displayName = person.name || person.id;
      for (const k of ['needs', 'hobbies', 'interests', 'qualities', 'greenFlags']) {
        if (!Array.isArray(person.profile[k])) person.profile[k] = [];
      }
    } catch (e) {
      person.profile = {
        displayName: person.name || person.id,
        tagline: 'Analysis unavailable',
        summary: 'Could not analyze this profile: ' + (e?.message || e),
        needs: [], hobbies: [], interests: [], qualities: [], greenFlags: [],
        lookingFor: '', vibe: 'reserved', datingStyle: '',
      };
    }
    send({ type: 'profile', id: person.id, name: person.name, linkedin: person.linkedin, instagram: person.instagram, profile: person.profile });
    return person;
  });

  // persist people now so profiles survive even if later steps are interrupted
  STATE = { people: roster, rankings: {}, dates: {}, createdAt: new Date().toISOString(), provider: PROVIDER };
  saveState();

  // 3) rank each person vs everyone else — local, instant, no API (works over the AI profiles)
  for (const person of roster) {
    send({ type: 'phase', phase: 'rank', id: person.id, name: person.name, status: 'working' });
    const candidates = roster.filter(p => p.id !== person.id);
    const ranks = rankLocally(person, candidates).map(r => ({
      id: r.id, name: r.name, score: Math.max(0, Math.min(100, Math.round(r.score))), reason: r.reason || '',
    }));
    STATE.rankings[person.id] = ranks;
    send({ type: 'rankings', id: person.id, rankings: ranks });
  }
  saveState();

  // 4) run real dates for the strongest unique pairs (paced to respect free-tier rate limits)
  const topPairs = [];
  const seen = new Set();
  for (const person of roster) {
    const top = STATE.rankings[person.id]?.[0];
    if (!top) continue;
    const key = dateKey(person.id, top.id);
    if (seen.has(key)) continue;
    seen.add(key);
    topPairs.push([person, roster.find(p => p.id === top.id)]);
  }
  const MAX_AUTO_DATES = Number(process.env.MAX_AUTO_DATES || 8);
  const chosen = topPairs.slice(0, MAX_AUTO_DATES);
  send({ type: 'datePlan', count: chosen.length });
  for (const [a, b] of chosen) {
    const key = dateKey(a.id, b.id);
    send({ type: 'phase', phase: 'date', id: key, name: `${a.profile.displayName} x ${b.profile.displayName}`, status: 'working' });
    try {
      const date = await runDate(a, b);
      STATE.dates[key] = { aId: a.id, bId: b.id, aName: a.profile.displayName, bName: b.profile.displayName, ...date };
      send({ type: 'date', key, date: STATE.dates[key] });
      saveState();
    } catch (e) {
      console.log('date error', key, e?.message);
      send({ type: 'phase', phase: 'date', id: key, status: 'error', error: String(e?.message || e) });
    }
    await new Promise(r => setTimeout(r, 700)); // pace for rate limits
  }
  saveState();

  send({ type: 'done', people: roster.length, dates: Object.keys(STATE.dates).length });
  res.end();
});

// Run (or fetch cached) a date between any two people on demand.
app.post('/api/date', async (req, res) => {
  const { aId, bId } = req.body || {};
  const a = STATE.people.find(p => p.id === aId);
  const b = STATE.people.find(p => p.id === bId);
  if (!a || !b) return res.status(404).json({ error: 'Unknown person id' });
  const key = dateKey(aId, bId);
  if (STATE.dates[key]) return res.json(STATE.dates[key]);
  try {
    const date = await runDate(a, b);
    STATE.dates[key] = { aId: a.id, bId: b.id, aName: a.profile.displayName, bName: b.profile.displayName, ...date };
    saveState();
    res.json(STATE.dates[key]);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  💘 Agent Dating running on http://localhost:${PORT}`);
  console.log(`  LLM provider: ${PROVIDER === 'none' ? '⚠️  NONE — set GEMINI_API_KEY or GROQ_API_KEY in .env' : PROVIDER}\n`);
});
