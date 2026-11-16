import crypto from 'node:crypto';
import express from 'express';
import { db, save } from './store.js';
import { hashPassword, verifyPassword, createSession, deleteSession, requireAuth, publicUser } from './auth.js';
import { providerStatus, complete } from './ai.js';

const PORT = process.env.PORT || 4000;
// Comma-separated list of front-end origins allowed to call the API, e.g. https://main.d1234.amplifyapp.com
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim());
const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

const PROFILE_FIELDS = ['name', 'products', 'brand_voice', 'target_audience'];

function seedFirstUser() {
  const state = db();
  if (state.users.length) return;

  const companyId = id();
  state.companies.push({
    id: companyId,
    name: 'My Company',
    products: '',
    brand_voice: '',
    target_audience: '',
    created_at: now(),
  });
  state.users.push({
    id: id(),
    company_id: companyId,
    email: process.env.SEED_EMAIL || 'demo@scenex.local',
    name: 'Demo User',
    password: hashPassword(process.env.SEED_PASSWORD || 'changeme123'),
  });
  save();
  console.log(`Seeded login: ${process.env.SEED_EMAIL || 'demo@scenex.local'} (set SEED_PASSWORD to change the password)`);
}

// ---- Auth -----------------------------------------------------------------

app.post('/api/auth/login', (req, res) => {
  const { email = '', password = '' } = req.body;
  const state = db();
  const user = state.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: 'Wrong email or password.' });
  }
  const token = createSession(user.id);
  const company = state.companies.find((c) => c.id === user.company_id);
  res.json({ token, user: publicUser(user), company });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  deleteSession(req.token);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), company: req.company });
});

// ---- Company profile ------------------------------------------------------

app.put('/api/company', requireAuth, (req, res) => {
  const body = req.body || {};
  if (!String(body.name || '').trim()) {
    return res.status(400).json({ error: 'Company name is required.' });
  }
  for (const field of PROFILE_FIELDS) {
    req.company[field] = String(body[field] || '').trim();
  }
  req.company.updated_at = now();
  save();
  res.json({ company: req.company });
});

// ---- Chats ----------------------------------------------------------------

function ownChat(req, res) {
  const chat = db().chats.find((c) => c.id === req.params.id && c.company_id === req.company.id);
  if (!chat) res.status(404).json({ error: 'Chat not found.' });
  return chat;
}

app.get('/api/providers', requireAuth, async (req, res) => {
  res.json({ providers: await providerStatus() });
});

app.get('/api/chats', requireAuth, (req, res) => {
  const chats = db()
    .chats.filter((c) => c.company_id === req.company.id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  res.json({ chats });
});

app.post('/api/chats', requireAuth, (req, res) => {
  const state = db();
  const chat = { id: id(), company_id: req.company.id, user_id: req.user.id, title: 'New chat', created_at: now(), updated_at: now() };
  state.chats.push(chat);
  save();
  res.status(201).json({ chat });
});

app.get('/api/chats/:id', requireAuth, (req, res) => {
  const chat = ownChat(req, res);
  if (!chat) return;
  const messages = db().messages.filter((m) => m.chat_id === chat.id);
  res.json({ chat, messages });
});

app.delete('/api/chats/:id', requireAuth, (req, res) => {
  const chat = ownChat(req, res);
  if (!chat) return;
  const state = db();
  state.chats = state.chats.filter((c) => c.id !== chat.id);
  state.messages = state.messages.filter((m) => m.chat_id !== chat.id);
  save();
  res.json({ ok: true });
});

function systemPrompt(company) {
  const lines = [
    `You are the marketing assistant for ${company.name}.`,
    'Write captions, hashtags and ad copy that fit this business. Keep posts short and ready to publish.',
    'Nothing is published without the owner approving it, so offer drafts rather than assuming they are final.',
  ];
  if (company.products) lines.push(`Products and services:\n${company.products}`);
  if (company.brand_voice) lines.push(`Brand voice:\n${company.brand_voice}`);
  if (company.target_audience) lines.push(`Target audience:\n${company.target_audience}`);
  return lines.join('\n\n');
}

app.post('/api/chats/:id/messages', requireAuth, async (req, res) => {
  const chat = ownChat(req, res);
  if (!chat) return;

  const content = String(req.body.content || '').trim();
  const provider = req.body.provider === 'claude' ? 'claude' : 'local';
  if (!content) return res.status(400).json({ error: 'Message is empty.' });

  const state = db();
  const userMessage = { id: id(), chat_id: chat.id, role: 'user', content, created_at: now() };
  state.messages.push(userMessage);
  if (chat.title === 'New chat') chat.title = content.slice(0, 60);

  // Keep the last 30 messages as context so long chats stay within the model's limits.
  const history = state.messages
    .filter((m) => m.chat_id === chat.id)
    .slice(-30)
    .map(({ role, content }) => ({ role, content }));

  try {
    const reply = await complete({ provider, system: systemPrompt(req.company), messages: history });
    const assistantMessage = { id: id(), chat_id: chat.id, role: 'assistant', content: reply, provider, created_at: now() };
    state.messages.push(assistantMessage);

    chat.updated_at = now();
    save();
    res.json({ userMessage, assistantMessage, chat });
  } catch (err) {
    // Keep the user's message so they can retry with the other provider.
    chat.updated_at = now();
    save();
    res.status(502).json({ error: err.message, userMessage });
  }
});

// ---- Start ----------------------------------------------------------------

seedFirstUser();
app.listen(PORT, () => console.log(`Scenex AI API on http://localhost:${PORT}`));

