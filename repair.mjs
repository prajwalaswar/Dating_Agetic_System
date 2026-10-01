// repair.mjs — finish/repair the saved demo dataset without hammering the API all at once.
import fs from 'fs';
import { analyzePerson, rankLocally, runDate } from './agents.js';

const FILE = './data/state.json';
const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const save = () => fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isBad = p => { const pr = p.profile || {}; return (pr.interests || []).length === 0 || pr.tagline === 'Analysis unavailable'; };

// 1) re-analyze only the failed profiles, paced
const bad = s.people.filter(isBad);
console.log('re-analyzing', bad.length, 'profiles…');
for (const person of bad) {
  try {
    const prof = await analyzePerson(person);
    if (!prof.displayName) prof.displayName = person.name;
    for (const k of ['needs', 'hobbies', 'interests', 'qualities', 'greenFlags']) if (!Array.isArray(prof[k])) prof[k] = [];
    person.profile = prof;
    process.stdout.write(` ✓${person.name}`);
  } catch (e) {
    process.stdout.write(` ✗${person.name}(${e.message.slice(0, 20)})`);
  }
  save();
  await sleep(1500);
}
console.log('\nremaining bad:', s.people.filter(isBad).length);

// 2) recompute rankings locally (instant)
for (const person of s.people) {
  const cands = s.people.filter(p => p.id !== person.id);
  s.rankings[person.id] = rankLocally(person, cands);
}
save();
console.log('rankings done for', Object.keys(s.rankings).length, 'people');

// 3) generate dates for the strongest unique pairs, paced
const key = (a, b) => [a, b].sort().join('__');
const byId = Object.fromEntries(s.people.map(p => [p.id, p]));
const want = [];
const seen = new Set(Object.keys(s.dates));
for (const p of s.people) {
  for (const cand of (s.rankings[p.id] || []).slice(0, 1)) {
    const k = key(p.id, cand.id);
    if (!seen.has(k)) { seen.add(k); want.push([p.id, cand.id]); }
  }
  if (want.length >= 10) break;
}
console.log('generating up to', want.length, 'dates…');
let ok = 0;
for (const [aId, bId] of want) {
  const a = byId[aId], b = byId[bId];
  const k = key(aId, bId);
  try {
    const d = await runDate(a, b);
    s.dates[k] = { aId, bId, aName: a.profile.displayName, bName: b.profile.displayName, ...d };
    ok++; process.stdout.write('.');
    save();
  } catch (e) { process.stdout.write('x'); }
  await sleep(1200);
}
console.log('\ndates now:', Object.keys(s.dates).length, '(new ok:', ok, ')');
console.log('DONE.');
