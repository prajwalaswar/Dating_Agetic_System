// llm.js — unified free-LLM client. Uses Gemini (GEMINI_API_KEY) or Groq (GROQ_API_KEY).
import 'dotenv/config';

const GEMINI_KEY = process.env.GEMINI_API_KEY?.trim();
const GROQ_KEY = process.env.GROQ_API_KEY?.trim();
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-20b';

export const PROVIDER = GEMINI_KEY ? 'gemini' : GROQ_KEY ? 'groq' : 'none';

function stripFences(text) {
  if (!text) return text;
  return text.replace(/```(?:json)?/gi, '').trim();
}

// Pull the first balanced JSON object/array out of a messy LLM reply.
export function extractJSON(text) {
  if (!text) return null;
  const cleaned = stripFences(text);
  try { return JSON.parse(cleaned); } catch { /* keep going */ }
  const start = cleaned.search(/[[{]/);
  if (start === -1) return null;
  const open = cleaned[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          const slice = cleaned.slice(start, i + 1);
          try { return JSON.parse(slice); } catch { return null; }
        }
      }
    }
  }
  return null;
}

async function callGemini(prompt, { json = false, temperature = 0.7 } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: 2048,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
}

async function callGroq(prompt, { json = false, temperature = 0.7 } = {}) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const body = {
    model: GROQ_MODEL,
    temperature,
    max_tokens: 1024, // Groq reserves this against the 8k/min TPM budget — keep it tight so calls fit
    messages: [{ role: 'user', content: prompt }],
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Groq ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

// Retry with rate-limit-aware backoff (free tiers 429 often under load).
export async function llm(prompt, opts = {}) {
  if (PROVIDER === 'none') {
    throw new Error('No LLM key set. Put GEMINI_API_KEY or GROQ_API_KEY in your .env file.');
  }
  const fn = PROVIDER === 'gemini' ? callGemini : callGroq;
  const maxTries = 5;
  let lastErr;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    try {
      return await fn(prompt, opts);
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const rateLimited = /429|rate limit|too many/i.test(msg);
      const overloaded = /503|unavailable|high demand|overloaded/i.test(msg);
      // try to honor a "try again in Xs" hint
      const hint = msg.match(/in\s+([\d.]+)\s*s/i);
      let waitMs = rateLimited
        ? (hint ? Math.ceil(parseFloat(hint[1]) * 1000) + 400 : 2500 * (attempt + 1))
        : overloaded ? 1500 * (attempt + 1)
        : 1200;
      waitMs = Math.min(waitMs, 20000);
      if (attempt < maxTries - 1) await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

export async function llmJSON(prompt, opts = {}) {
  const raw = await llm(prompt, { ...opts, json: true });
  const parsed = extractJSON(raw);
  if (!parsed) throw new Error('LLM did not return valid JSON');
  return parsed;
}
