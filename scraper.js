// scraper.js — pulls public data from Instagram + LinkedIn URLs. No login, best-effort.
import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function handleFromUrl(url, kind) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (kind === 'linkedin') {
      const i = parts.indexOf('in');
      return i >= 0 ? parts[i + 1] : parts[parts.length - 1] || '';
    }
    return parts[0] || '';
  } catch {
    return url;
  }
}

async function fetchText(url, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body, headers: res.headers };
  } catch (e) {
    return { ok: false, status: 0, body: '', error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// Grab anonymous cookies (csrftoken, mid) so Instagram's web API is less likely to 429/401.
let IG_COOKIE_CACHE = null;
async function instagramCookies() {
  if (IG_COOKIE_CACHE) return IG_COOKIE_CACHE;
  const sessionid = process.env.IG_SESSIONID?.trim();
  const res = await fetchText('https://www.instagram.com/', { Accept: 'text/html' });
  const raw = res.headers?.getSetCookie ? res.headers.getSetCookie() : [];
  let cookie = (raw || []).filter(Boolean).map(c => c.split(';')[0]).join('; ');
  if (sessionid) cookie = (cookie ? cookie + '; ' : '') + `sessionid=${sessionid}`;
  IG_COOKIE_CACHE = cookie;
  return cookie;
}

// Instagram public profile via the web_profile_info endpoint (no login; best-effort).
export async function scrapeInstagram(url) {
  const username = handleFromUrl(url, 'instagram').replace('@', '');
  const out = { source: 'instagram', url, username, ok: false, bio: '', fullName: '', followers: null, posts: [], note: '' };
  if (!username) return out;

  const cookie = await instagramCookies();
  const api = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const headers = {
    'x-ig-app-id': '936619743392459',
    'x-requested-with': 'XMLHttpRequest',
    Accept: '*/*',
    Referer: `https://www.instagram.com/${username}/`,
    ...(cookie ? { Cookie: cookie } : {}),
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchText(api, headers);
    if (res.ok) {
      try {
        const json = JSON.parse(res.body);
        const user = json?.data?.user;
        if (user) {
          out.ok = true;
          out.fullName = user.full_name || '';
          out.bio = user.biography || '';
          out.followers = user.edge_followed_by?.count ?? null;
          out.category = user.category_name || '';
          out.external = user.external_url || '';
          const edges = user.edge_owner_to_timeline_media?.edges || [];
          out.posts = edges.slice(0, 12)
            .map(e => e.node?.edge_media_to_caption?.edges?.[0]?.node?.text || '')
            .filter(Boolean);
          return out;
        }
      } catch { /* fall through */ }
    }
    if (res.status === 429 || res.status === 401) {
      out.note = 'Instagram rate-limited/blocked this request (anonymous access). Set IG_SESSIONID in .env for reliable results.';
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }
    break;
  }
  if (!out.note) out.note = 'Instagram returned no public data for this handle.';
  return out;
}

// LinkedIn public profile — best-effort og: meta + visible text (LinkedIn frequently blocks bots).
export async function scrapeLinkedIn(url) {
  const slug = handleFromUrl(url, 'linkedin');
  const out = { source: 'linkedin', url, slug, ok: false, name: '', headline: '', about: '', raw: '' };
  const page = await fetchText(url);
  if (page.body) {
    const $ = cheerio.load(page.body);
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';
    out.name = ogTitle.split(' - ')[0].split(' | ')[0].trim();
    out.headline = ogTitle.includes(' - ') ? ogTitle.split(' - ').slice(1).join(' - ').trim() : '';
    out.about = ogDesc.trim();
    // Try JSON-LD person block when present.
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).contents().text());
        const g = Array.isArray(data?.['@graph']) ? data['@graph'] : [data];
        const person = g.find(x => x?.['@type'] === 'Person');
        if (person) {
          out.name = out.name || person.name || '';
          out.headline = out.headline || person.jobTitle || '';
          out.about = out.about || person.description || '';
        }
      } catch { /* ignore */ }
    });
    out.ok = Boolean(out.name || out.headline || out.about);
  }
  // humanize slug as a last resort for the name
  if (!out.name && slug) {
    out.name = slug.replace(/-[0-9a-z]{6,}$/i, '').split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
  }
  return out;
}

export async function scrapePerson({ linkedin, instagram }) {
  const [li, ig] = await Promise.all([
    linkedin ? scrapeLinkedIn(linkedin) : Promise.resolve(null),
    instagram ? scrapeInstagram(instagram) : Promise.resolve(null),
  ]);
  return { linkedin: li, instagram: ig };
}
