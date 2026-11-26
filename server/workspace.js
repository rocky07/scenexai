// Scheduled briefings (daily briefing, weekly review, content ideas) and search across the workspace.
import crypto from 'node:crypto';
import { db, save } from './store.js';
import { complete } from './ai.js';
import { plugins } from './plugins/index.js';
import { connectionsFor, connectionWithToken } from './plugins/shared.js';
import { publishToTargets } from './drafts.js';

// Times use the server's clock. Set TZ in the environment (for example TZ=America/New_York) to match your team.
export const KINDS = {
  daily_briefing: {
    title: 'Daily briefing',
    frequency: 'daily',
    hour: 8,
    weekday: null,
    prompt:
      'Write today\'s briefing for the team in under 250 words. Cover: which messages need a reply first, what changed since yesterday, and three priorities for today.',
  },
  weekly_review: {
    title: 'Weekly review',
    frequency: 'weekly',
    hour: 9,
    weekday: 1,
    prompt:
      'Write a weekly review in under 300 words. Cover: what went well, what needs attention, and the three things to focus on next week.',
  },
  content_ideas: {
    title: 'Content ideas',
    frequency: 'weekly',
    hour: 9,
    weekday: 3,
    prompt:
      'Write three social media posts for the coming week that fit the brand voice. Reply with only a JSON array, ' +
      'no other text. Each item must be an object with "hook" (a short title) and "text" (the ready-to-publish post, ' +
      'under 280 characters, no hashtags unless they fit naturally).',
  },
};

function nextRun(frequency, hour, weekday, from = new Date()) {
  const d = new Date(from);
  d.setHours(hour, 0, 0, 0);
  if (frequency === 'daily') {
    if (d <= from) d.setDate(d.getDate() + 1);
  } else {
    d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
    if (d <= from) d.setDate(d.getDate() + 7);
  }
  return d.toISOString();
}

function tables() {
  const state = db();
  state.scheduled ||= [];
  state.briefings ||= [];
  return state;
}

// Creates the three default tasks for a company the first time they're needed.
export function tasksFor(companyId) {
  const state = tables();
  for (const [kind, def] of Object.entries(KINDS)) {
    if (state.scheduled.some((t) => t.company_id === companyId && t.kind === kind)) continue;
    state.scheduled.push({
      id: crypto.randomUUID(),
      company_id: companyId,
      kind,
      enabled: true,
      frequency: def.frequency,
      hour: def.hour,
      weekday: def.weekday,
      last_run_at: null,
      next_run_at: nextRun(def.frequency, def.hour, def.weekday),
      last_error: null,
    });
  }
  save();
  return state.scheduled.filter((t) => t.company_id === companyId);
}

export function updateTask(companyId, taskId, { enabled, hour, weekday }) {
  const task = tasksFor(companyId).find((t) => t.id === taskId);
  if (!task) return null;
  if (typeof enabled === 'boolean') task.enabled = enabled;
  if (Number.isInteger(hour) && hour >= 0 && hour <= 23) task.hour = hour;
  if (task.frequency === 'weekly' && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) task.weekday = weekday;
  task.next_run_at = nextRun(task.frequency, task.hour, task.weekday);
  save();
  return task;
}

export function briefingsFor(companyId, limit = 30) {
  return tables()
    .briefings.filter((b) => b.company_id === companyId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

// Gathers what the model should look at: company profile, connected inboxes, recent chats.
async function gatherContext(company) {
  const lines = [];
  for (const field of ['products', 'brand_voice', 'target_audience']) {
    if (company[field]) lines.push(`${field.replace('_', ' ')}: ${company[field]}`);
  }

  for (const plugin of plugins.filter((p) => p.capabilities.inbox)) {
    for (const account of connectionsFor(company.id, plugin.id)) {
      const conn = connectionWithToken(company.id, plugin.id, account.id);
      try {
        const conversations = await plugin.inbox.conversations(conn);
        lines.push(`${plugin.name} – ${account.name}: ${conversations.length} recent conversations`);
        for (const conv of conversations.slice(0, 10)) {
          lines.push(`- ${conv.customer?.name || 'Customer'} (${conv.updated_time}): "${conv.snippet}"`);
        }
      } catch (err) {
        lines.push(`${plugin.name} – ${account.name}: messages could not be loaded (${err.message})`);
      }
    }
  }

  for (const plugin of plugins.filter((p) => p.capabilities.feed)) {
    for (const account of connectionsFor(company.id, plugin.id)) {
      const conn = connectionWithToken(company.id, plugin.id, account.id);
      try {
        const posts = (await plugin.feed.posts(conn, 10)).slice(0, 5);
        lines.push(`${plugin.name} – ${account.name}: top recent posts by engagement`);
        for (const post of posts) {
          const top = post.top_comments[0];
          lines.push(
            `- "${post.text.slice(0, 200)}" (${post.reactions} reactions, ${post.comments} comments)` +
              (top ? ` Top comment: "${top.text.slice(0, 120)}"` : ''),
          );
        }
      } catch (err) {
        lines.push(`${plugin.name} – ${account.name}: posts could not be loaded (${err.message})`);
      }
    }
  }

  const recentChats = tables().chats.filter((c) => c.company_id === company.id).slice(0, 8);
  if (recentChats.length) lines.push(`Recent chats: ${recentChats.map((c) => `"${c.title}"`).join(', ')}`);

  return lines.join('\n').slice(0, 6000) || 'No connected accounts or recent activity yet.';
}

// Tries Claude first when a key is set, then falls back to the local model if Claude fails.
// Pulls the structured posts out of a content-ideas reply. Returns [] if the reply isn't valid JSON.
export function parsePosts(text) {
  const match = String(text).match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0])
      .filter((item) => item && typeof item.text === 'string' && item.text.trim())
      .slice(0, 5)
      .map((item) => ({ hook: String(item.hook || '').slice(0, 120), text: item.text.trim().slice(0, 1000) }));
  } catch {
    return [];
  }
}

function readable(posts, fallback) {
  if (!posts.length) return fallback;
  return posts.map((p, i) => `${i + 1}. ${p.hook}\n${p.text}`).join('\n\n');
}

async function generate(company, kind) {
  const context = await gatherContext(company);
  const system = [
    `You are the marketing assistant for ${company.name}.`,
    'Write plain text with short headings. Nothing is published without the owner approving it.',
  ].join(' ');
  const messages = [{ role: 'user', content: `${KINDS[kind].prompt}\n\nContext:\n${context}` }];

  const order = process.env.ANTHROPIC_API_KEY ? ['claude', 'local'] : ['local'];
  const errors = [];
  for (const provider of order) {
    try {
      const content = await complete({ provider, system, messages });
      return { content, provider, fellBack: errors.length > 0 };
    } catch (err) {
      errors.push(`${provider}: ${err.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

const MAX_AUTO_POSTS = 3;

// Publishes up to MAX_AUTO_POSTS posts from a briefing to the owner's chosen accounts.
async function autoPublish(company, briefing) {
  for (const post of briefing.posts.slice(0, MAX_AUTO_POSTS)) {
    await publishToTargets(company.id, post.text, company.auto_post.targets, { auto: true, source: briefing.id });
  }
}

export async function runTask(companyId, task) {
  const state = tables();
  const company = state.companies.find((c) => c.id === companyId);
  const now = new Date().toISOString();
  try {
    const { content, provider, fellBack } = await generate(company, task.kind);
    const posts = task.kind === 'content_ideas' ? parsePosts(content) : [];
    const briefing = {
      id: crypto.randomUUID(),
      company_id: companyId,
      kind: task.kind,
      title: KINDS[task.kind].title,
      content: readable(posts, content),
      posts,
      provider,
      created_at: now,
    };
    state.briefings.push(briefing);
    state.briefings = state.briefings.slice(-500);
    // Auto-post runs only if the owner turned it on for this company.
    if (posts.length && company.auto_post?.enabled && company.auto_post.targets?.length) {
      autoPublish(company, briefing).catch((err) => console.error('Auto-post failed:', err.message));
    }
    // Say so when the local model wrote it, so the owner knows why it differs.
    task.note = fellBack ? 'Claude was unavailable, so the local model wrote the last briefing.' : null;
    task.last_error = null;
    task.last_run_at = now;
    task.next_run_at = nextRun(task.frequency, task.hour, task.weekday);
    save();
    return briefing;
  } catch (err) {
    // Still move the schedule forward so a failing provider doesn't retry every minute.
    task.last_error = err.message;
    task.last_run_at = now;
    task.next_run_at = nextRun(task.frequency, task.hour, task.weekday);
    save();
    throw err;
  }
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const state = tables();
    const now = Date.now();
    for (const task of state.scheduled.filter((t) => t.enabled && new Date(t.next_run_at).getTime() <= now)) {
      try {
        await runTask(task.company_id, task);
      } catch (err) {
        console.error(`Scheduled ${task.kind} failed:`, err.message);
      }
    }
  } finally {
    ticking = false;
  }
}

export function startScheduler() {
  setInterval(tick, 60_000);
}

// ---- Search ----------------------------------------------------------------

export function search(companyId, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return { chats: [], briefings: [], plugins: [], accounts: [] };
  const has = (text) => String(text || '').toLowerCase().includes(needle);
  const state = tables();

  const chatIds = new Set();
  const chats = state.chats.filter((c) => c.company_id === companyId);
  for (const msg of state.messages) {
    if (has(msg.content)) chatIds.add(msg.chat_id);
  }
  const chatHits = chats
    .filter((c) => has(c.title) || chatIds.has(c.id))
    .slice(0, 10)
    .map((c) => ({ id: c.id, title: c.title, updated_at: c.updated_at }));

  const briefingHits = briefingsFor(companyId, 200)
    .filter((b) => has(b.title) || has(b.content))
    .slice(0, 10)
    .map((b) => ({ id: b.id, title: b.title, created_at: b.created_at }));

  const pluginHits = plugins
    .filter((p) => has(p.name) || has(p.description))
    .map((p) => ({ id: p.id, name: p.name }));

  const accountHits = plugins.flatMap((p) =>
    connectionsFor(companyId, p.id)
      .filter((c) => has(c.name))
      .map((c) => ({ plugin_id: p.id, plugin_name: p.name, id: c.id, name: c.name })),
  );

  return { chats: chatHits, briefings: briefingHits, plugins: pluginHits, accounts: accountHits };
}
