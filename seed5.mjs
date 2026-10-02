// seed5.mjs — fill the 5 profiles whose both sources were blocked AND the free LLM quota is
// exhausted for today. These are the same name-inferred personas the analyze step produces for
// blocked sources; seeded manually only because Gemini (20/day) and Groq (daily token cap) are tapped out.
import fs from 'fs';
import { rankLocally } from './agents.js';

const FILE = './data/state.json';
const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const SEED = {
  p16: { // Simon Sinek
    displayName: 'Simon Sinek', tagline: 'Start with why — then build something that lasts',
    summary: 'A leadership thinker and optimist who believes purpose comes before profit. Warm, curious, and endlessly interested in what makes people tick.',
    needs: ['a partner who shares a sense of purpose', 'honest, deep conversation', 'mutual encouragement'],
    hobbies: ['writing', 'public speaking', 'long walks and thinking'],
    interests: ['leadership', 'human behavior', 'storytelling'],
    qualities: ['optimistic', 'thoughtful', 'great listener'],
    lookingFor: 'Someone grounded and genuine who values meaning over status and can trade big ideas late into the night.',
    vibe: 'intellectual',
    greenFlags: ['empathetic', 'driven by purpose', 'calm under pressure'],
    datingStyle: 'Asks the deep questions early and actually listens to the answers.',
  },
  p17: { // Mel Robbins
    displayName: 'Mel Robbins', tagline: 'Stop waiting for permission — just go',
    summary: 'A motivational force who turned a simple idea into a movement. Direct, relatable, and allergic to overthinking.',
    needs: ['a partner who matches her energy', 'honesty without games', 'someone who roots for her'],
    hobbies: ['podcasting', 'working out', 'family time'],
    interests: ['psychology', 'self-improvement', 'public speaking'],
    qualities: ['motivating', 'candid', 'resilient'],
    lookingFor: 'A confident, down-to-earth partner who takes action and does not need coddling.',
    vibe: 'ambitious',
    greenFlags: ['supportive', 'high energy', 'emotionally honest'],
    datingStyle: 'Cuts the small talk, says what she means, and makes you laugh doing it.',
  },
  p22: { // Ann Handley
    displayName: 'Ann Handley', tagline: 'Everybody writes — she just does it better',
    summary: 'A pioneering content marketer with a writer\'s wit and a teacher\'s patience. Playful, precise, and quietly rebellious about doing things well.',
    needs: ['a partner who appreciates good writing and dry humor', 'intellectual spark', 'room to create'],
    hobbies: ['writing', 'reading', 'collecting good stories'],
    interests: ['marketing', 'language', 'creativity'],
    qualities: ['witty', 'detail-oriented', 'generous mentor'],
    lookingFor: 'A clever, kind person who gets her humor and respects the craft of a well-made thing.',
    vibe: 'creative',
    greenFlags: ['smart', 'warm', 'funny'],
    datingStyle: 'Charms you with a perfectly timed one-liner, then surprises you with real depth.',
  },
  p23: { // Seth Godin
    displayName: 'Seth Godin', tagline: 'Make something people miss when it\'s gone',
    summary: 'A marketing legend and relentless idea machine. Provocative, generous with knowledge, and never content with the ordinary.',
    needs: ['a partner who thinks for themselves', 'curiosity', 'space for big projects'],
    hobbies: ['writing daily', 'reading voraciously', 'building communities'],
    interests: ['marketing', 'change-making', 'teaching'],
    qualities: ['original', 'generous', 'disciplined'],
    lookingFor: 'An independent, curious person unafraid of unconventional ideas and comfortable with a creative life.',
    vibe: 'intellectual',
    greenFlags: ['principled', 'curious', 'encouraging'],
    datingStyle: 'Challenges your assumptions kindly and leaves you thinking for days.',
  },
  p25: { // Lewis Howes
    displayName: 'Lewis Howes', tagline: 'Chasing greatness, on and off the field',
    summary: 'A former pro athlete turned podcaster who built a platform on vulnerability and growth. Driven, open, and always leveling up.',
    needs: ['a partner who values growth', 'emotional openness', 'shared ambition'],
    hobbies: ['podcasting', 'sports', 'traveling'],
    interests: ['personal development', 'entrepreneurship', 'wellness'],
    qualities: ['ambitious', 'vulnerable', 'disciplined'],
    lookingFor: 'A warm, ambitious partner who is on their own growth journey and communicates openly.',
    vibe: 'ambitious',
    greenFlags: ['open-hearted', 'motivated', 'health-conscious'],
    datingStyle: 'Leads with genuine curiosity about your dreams and shares his own just as freely.',
  },
};

for (const [id, prof] of Object.entries(SEED)) {
  const person = s.people.find(p => p.id === id);
  if (person) person.profile = prof;
}

// recompute rankings for everyone now that all 25 have full profiles
for (const person of s.people) {
  const cands = s.people.filter(p => p.id !== person.id);
  s.rankings[person.id] = rankLocally(person, cands);
}

fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
const good = s.people.filter(p => (p.profile?.interests || []).length > 0 && p.profile?.tagline !== 'Analysis unavailable').length;
console.log('seeded 5 | good profiles now', good, '/ 25 | dates', Object.keys(s.dates).length);
