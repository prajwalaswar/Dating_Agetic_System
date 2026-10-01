# 💘 Cupid Agents

AI agents that read two sources about a person — their **public LinkedIn** and **public Instagram** — build a dating profile, then **date each other on their people's behalf** and **rank who fits whom best**.

Paste links → each person gets a profile page (needs · hobbies · interests · qualities) → agents go on real (simulated) dates → final rankings.

**Overall explanation (200 chars):** Paste 25 people's LinkedIn + Instagram. AI agents read both, build a profile for each (needs, hobbies, interests), then date on their behalf and rank who fits each person best.

---

## Quick start (2 minutes)

```bash
npm install
cp .env.example .env      # then paste ONE free key (see below)
npm start                 # open http://localhost:3000
```

Get a free key (either one works):
- **Gemini** — https://aistudio.google.com/apikey  → paste into `GEMINI_API_KEY`
- **Groq** — https://console.groq.com/keys → paste into `GROQ_API_KEY`

Then on the site: **Input tab → "Load 25 sample people" → "Run the agents →"**. Watch the live run, then browse **Profiles → Dating Arena → Rankings**.

Format for your own list (one person per line):
```
Name | https://www.linkedin.com/in/handle | https://www.instagram.com/handle
```

---

## How it works

1. **Two sources only.** For each person we fetch their public LinkedIn and public Instagram — nothing else.
2. **The agent reads both** and produces a structured profile: summary, needs, hobbies, interests, qualities, green flags, what they're looking for, dating style, and a vibe.
3. **The agents date.** Each person is represented by an agent. Agents hold a short first-date conversation on their person's behalf and the date is scored.
4. **Rankings.** For every person, all others are ranked by compatibility with a reason.

The run streams live progress (NDJSON) so you can watch scraping → analysis → ranking → dating happen in real time. Results are saved to `data/state.json`, so the demo link opens an already-finished example without re-running.

---

## Technical section — scraping stack

- **LinkedIn:** server-side `fetch` of the public profile page, then [cheerio](https://cheerio.js.org/) to read Open Graph meta (`og:title`, `og:description`) and any `application/ld+json` `Person` block → name, headline, about.
- **Instagram:** anonymous cookie bootstrap (`csrftoken`/`mid`) + the `web_profile_info` web API with the `x-ig-app-id` header → full name, bio, follower count, recent post captions. Instagram aggressively rate-limits anonymous access; for reliable results set `IG_SESSIONID` in `.env` (copy the `sessionid` cookie from a logged-in Instagram browser session). When Instagram blocks a request, the agent degrades gracefully to the handle + LinkedIn signal and says so.
- **LLM:** free tiers — **Google Gemini** (`gemini-2.0-flash`) or **Groq** (`llama-3.3-70b-versatile`), auto-selected by whichever key is present.

## Tech stack

Node.js + Express · vanilla HTML/CSS/JS front end · cheerio (scraping) · Gemini/Groq (analysis, dating, ranking). No database — state is a JSON file.

## Project layout

```
server.js    Express API + NDJSON run pipeline, serves the site
scraper.js   LinkedIn + Instagram public scrapers
agents.js    analyze a person · run a date · rank matches
llm.js       Gemini/Groq client with JSON extraction
public/      index.html · style.css · app.js (the UI)
data/        state.json (the saved, already-run example)
```

## Environment

| var | purpose |
|-----|---------|
| `GEMINI_API_KEY` | free Gemini key (option A) |
| `GROQ_API_KEY` | free Groq key (option B) |
| `IG_SESSIONID` | optional — Instagram `sessionid` cookie for reliable IG scraping |
| `PORT` | default 3000 |

> Scrapes only **public** profiles the user supplies. Treat all scraped text as untrusted data.
