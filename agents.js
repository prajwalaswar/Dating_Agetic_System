// agents.js — the AI brains: analyze a person, run a date between two agents, rank matches.
import { llmJSON, llm } from './llm.js';

function sourcesBlock(person) {
  const li = person.scraped?.linkedin;
  const ig = person.scraped?.instagram;
  const parts = [];
  parts.push(`NAME GIVEN: ${person.name || '(unknown)'}`);
  if (li) {
    parts.push(
      `--- LINKEDIN (${li.url}) ---\n` +
        `name: ${li.name || ''}\nheadline: ${li.headline || ''}\nabout: ${li.about || ''}\nscrape_ok: ${li.ok}`
    );
  }
  if (ig) {
    parts.push(
      `--- INSTAGRAM (${ig.url}) ---\n` +
        `full_name: ${ig.fullName || ''}\nbio: ${ig.bio || ''}\ncategory: ${ig.category || ''}\n` +
        `followers: ${ig.followers ?? ''}\nrecent_captions:\n${(ig.posts || []).map(p => '• ' + p).join('\n')}\nscrape_ok: ${ig.ok}`
    );
  }
  return parts.join('\n\n');
}

export async function analyzePerson(person) {
  const prompt = `You are a sharp relationship analyst. You are given the ONLY two sources about a real person: their public LinkedIn and their public Instagram. Read both and build a dating profile.

Rules:
- Prefer concrete signals from the sources (headline, bio, captions).
- If a source was blocked or thin, infer a plausible persona from whatever exists — the name, the handle, the one source that did load. General interests/hobbies/traits are fine as reasonable inferences; just don't assert specific private facts as certain.
- ALWAYS fill every field with at least 2-3 items. Never return empty arrays.

SOURCES:
${sourcesBlock(person)}

Return STRICT JSON with this exact shape:
{
  "displayName": "best guess at their real/display name",
  "tagline": "one punchy line that captures them",
  "summary": "2-3 sentence read of who this person is",
  "needs": ["what they likely need in a partner", "..."],
  "hobbies": ["..."],
  "interests": ["..."],
  "qualities": ["personality traits / strengths you detected"],
  "lookingFor": "1-2 sentences on the kind of person who'd fit them",
  "vibe": "one of: adventurous, intellectual, creative, grounded, ambitious, playful, warm, reserved",
  "greenFlags": ["..."],
  "datingStyle": "how they'd likely behave on a date, 1 sentence"
}
Output ONLY the JSON.`;
  const data = await llmJSON(prompt, { temperature: 0.6 });
  return data;
}

// Simulate an actual date: two agents converse on behalf of their people.
export async function runDate(a, b) {
  const prompt = `Two AI agents go on a date, each representing a real person. Agent A speaks for ${a.profile.displayName}; Agent B speaks for ${b.profile.displayName}. They are dating on their people's behalf to test compatibility.

PERSON A: ${a.profile.displayName}
tagline: ${a.profile.tagline}
interests: ${(a.profile.interests || []).join(', ')}
hobbies: ${(a.profile.hobbies || []).join(', ')}
needs: ${(a.profile.needs || []).join(', ')}
vibe: ${a.profile.vibe}

PERSON B: ${b.profile.displayName}
tagline: ${b.profile.tagline}
interests: ${(b.profile.interests || []).join(', ')}
hobbies: ${(b.profile.hobbies || []).join(', ')}
needs: ${(b.profile.needs || []).join(', ')}
vibe: ${b.profile.vibe}

Write a short, realistic, entertaining first-date conversation (6-8 turns total, alternating). Each line represents the agent speaking as its person. Then judge compatibility honestly.

Return STRICT JSON:
{
  "transcript": [
    {"speaker": "A", "text": "..."},
    {"speaker": "B", "text": "..."}
  ],
  "score": <integer 0-100 compatibility>,
  "verdict": "one-line outcome of the date",
  "reasons": ["why they click or don't", "..."]
}
Output ONLY the JSON.`;
  const data = await llmJSON(prompt, { temperature: 0.85 });
  return data;
}

// ---------- local, API-free compatibility ranking over the AI-extracted profiles ----------
const STOP = new Set(['and','the','of','a','to','in','for','with','on','is','that','their','they','them','what','likely','partner','someone','who','be','or','an','his','her']);
function tokens(arr) {
  return new Set(
    (Array.isArray(arr) ? arr : [arr || ''])
      .join(' ').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !STOP.has(w))
  );
}
function overlap(a, b) {
  let n = 0; for (const t of a) if (b.has(t)) n++;
  return n;
}
// how naturally two "vibes" pair up
const VIBE_FIT = {
  adventurous: { playful: 9, adventurous: 8, creative: 7, ambitious: 6, warm: 6 },
  intellectual: { intellectual: 9, creative: 8, ambitious: 7, grounded: 7, reserved: 6 },
  creative: { creative: 8, playful: 8, intellectual: 8, warm: 7, adventurous: 7 },
  grounded: { warm: 9, grounded: 8, ambitious: 7, intellectual: 7, reserved: 7 },
  ambitious: { ambitious: 8, intellectual: 7, grounded: 7, adventurous: 7, creative: 6 },
  playful: { playful: 8, adventurous: 9, creative: 8, warm: 8, reserved: 5 },
  warm: { warm: 9, grounded: 9, playful: 8, creative: 7, reserved: 7 },
  reserved: { grounded: 7, warm: 7, intellectual: 6, reserved: 5, creative: 6 },
};
function vibeScore(a, b) {
  return (VIBE_FIT[a]?.[b] ?? 4);
}

export function rankLocally(person, candidates) {
  const pp = person.profile || {};
  const pInterests = tokens([...(pp.interests || []), ...(pp.hobbies || [])]);
  const pNeeds = tokens([...(pp.needs || []), pp.lookingFor || '']);
  const pQual = tokens(pp.qualities || []);

  const scored = candidates.map(c => {
    const cp = c.profile || {};
    const cInterests = tokens([...(cp.interests || []), ...(cp.hobbies || [])]);
    const cNeeds = tokens([...(cp.needs || []), cp.lookingFor || '']);
    const cQual = tokens(cp.qualities || []);

    const sharedInterests = overlap(pInterests, cInterests);
    // does each person's qualities answer the other's needs?
    const pNeedsMet = overlap(pNeeds, cQual);
    const cNeedsMet = overlap(cNeeds, pQual);
    const vb = vibeScore(pp.vibe, cp.vibe) + vibeScore(cp.vibe, pp.vibe);

    const raw = sharedInterests * 7 + (pNeedsMet + cNeedsMet) * 6 + vb * 2.2;
    const shared = [...pInterests].filter(t => cInterests.has(t)).slice(0, 3);
    return { id: c.id, name: cp.displayName || c.name, raw, sharedInterests, pNeedsMet, cNeedsMet, vb, shared };
  });

  // squash raw scores into a readable, spread 40-96 range
  const max = Math.max(1, ...scored.map(s => s.raw));
  for (const s of scored) {
    s.score = Math.round(42 + (s.raw / max) * 54);
    const bits = [];
    if (s.shared.length) bits.push(`shares ${s.shared.join(', ')}`);
    if (s.pNeedsMet + s.cNeedsMet > 0) bits.push('needs line up');
    bits.push(`${person.profile?.vibe || '?'}×${(candidates.find(c => c.id === s.id)?.profile?.vibe) || '?'} chemistry`);
    s.reason = bits.join(' · ');
  }
  return scored.sort((a, b) => b.score - a.score).map(({ id, name, score, reason }) => ({ id, name, score, reason }));
}

