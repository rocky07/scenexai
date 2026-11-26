// Drafts: write a post once, then publish it to any connected account whose plugin supports publishing.
import crypto from 'node:crypto';
import { db, save } from './store.js';
import { pluginById } from './plugins/index.js';
import { connectionWithToken } from './plugins/shared.js';

const MAX_CHARS = 3000;

function drafts() {
  const state = db();
  state.drafts ||= [];
  return state.drafts;
}

const ownDraft = (companyId, draftId) => drafts().find((d) => d.id === draftId && d.company_id === companyId);

function cleanText(value) {
  const text = String(value || '').trim();
  if (!text) return { error: 'Write something before saving.' };
  if (text.length > MAX_CHARS) return { error: `Drafts are limited to ${MAX_CHARS} characters.` };
  return { text };
}

// Posts text to each target account and keeps a draft record of the result, including failures.
// Used for manual posts from content ideas and for auto-posting.
export async function publishToTargets(companyId, text, targets, { auto = false, source = null } = {}) {
  const now = new Date().toISOString();
  const draft = {
    id: crypto.randomUUID(),
    company_id: companyId,
    text,
    publications: [],
    errors: [],
    auto,
    source,
    created_at: now,
    updated_at: now,
  };
  for (const target of targets) {
    const plugin = pluginById(String(target.plugin_id || ''));
    if (!plugin?.capabilities?.publish) continue;
    const conn = connectionWithToken(companyId, plugin.id, String(target.connection_id || ''));
    if (!conn) {
      draft.errors.push({ plugin_id: plugin.id, account: 'Unknown account', message: 'Account is no longer connected.' });
      continue;
    }
    try {
      const { post_id } = await plugin.publish(conn, text);
      draft.publications.push({ plugin_id: plugin.id, account: conn.name, post_id, published_at: new Date().toISOString() });
    } catch (err) {
      draft.errors.push({ plugin_id: plugin.id, account: conn.name, message: err.message });
    }
  }
  drafts().push(draft);
  save();
  return draft;
}

export function mountDrafts(app, requireAuth) {
  // Post one content idea from a briefing to chosen accounts.
  app.post('/api/briefings/:id/posts/:index/publish', requireAuth, async (req, res) => {
    const briefing = db().briefings.find((b) => b.id === req.params.id && b.company_id === req.company.id);
    const post = briefing?.posts?.[Number(req.params.index)];
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    const targets = Array.isArray(req.body?.targets) ? req.body.targets.slice(0, 10) : [];
    if (targets.length === 0) return res.status(400).json({ error: 'Choose at least one account.' });
    const draft = await publishToTargets(req.company.id, post.text, targets, { source: briefing.id });
    res.json({ draft });
  });

  // Auto-post settings for the company: on/off and which accounts receive posts.
  app.get('/api/auto-post', requireAuth, (req, res) => {
    res.json({ auto_post: req.company.auto_post || { enabled: false, targets: [] } });
  });

  app.put('/api/auto-post', requireAuth, (req, res) => {
    const valid = (Array.isArray(req.body?.targets) ? req.body.targets : [])
      .filter((t) => {
        const plugin = pluginById(String(t?.plugin_id || ''));
        return plugin?.capabilities?.publish && connectionWithToken(req.company.id, plugin.id, String(t.connection_id || ''));
      })
      .map((t) => ({ plugin_id: t.plugin_id, connection_id: t.connection_id }));
    req.company.auto_post = { enabled: Boolean(req.body?.enabled) && valid.length > 0, targets: valid };
    save();
    res.json({ auto_post: req.company.auto_post });
  });

  app.get('/api/drafts', requireAuth, (req, res) => {
    const list = drafts()
      .filter((d) => d.company_id === req.company.id)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    res.json({ drafts: list });
  });

  app.post('/api/drafts', requireAuth, (req, res) => {
    const { text, error } = cleanText(req.body?.text);
    if (error) return res.status(400).json({ error });
    const draft = {
      id: crypto.randomUUID(),
      company_id: req.company.id,
      text,
      publications: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    drafts().push(draft);
    save();
    res.status(201).json({ draft });
  });

  app.put('/api/drafts/:id', requireAuth, (req, res) => {
    const draft = ownDraft(req.company.id, req.params.id);
    if (!draft) return res.status(404).json({ error: 'Draft not found.' });
    const { text, error } = cleanText(req.body?.text);
    if (error) return res.status(400).json({ error });
    draft.text = text;
    draft.updated_at = new Date().toISOString();
    save();
    res.json({ draft });
  });

  app.delete('/api/drafts/:id', requireAuth, (req, res) => {
    const state = db();
    state.drafts = drafts().filter((d) => !(d.id === req.params.id && d.company_id === req.company.id));
    save();
    res.json({ ok: true });
  });

  app.post('/api/drafts/:id/publish', requireAuth, async (req, res) => {
    const draft = ownDraft(req.company.id, req.params.id);
    if (!draft) return res.status(404).json({ error: 'Draft not found.' });

    const plugin = pluginById(String(req.body?.plugin_id || ''));
    if (!plugin?.capabilities?.publish) return res.status(400).json({ error: 'That account cannot publish posts.' });

    const conn = connectionWithToken(req.company.id, plugin.id, String(req.body?.connection_id || ''));
    if (!conn) return res.status(404).json({ error: 'Account not found. Connect it on the Setup tab.' });

    try {
      const { post_id } = await plugin.publish(conn, draft.text);
      const now = new Date().toISOString();
      draft.publications.push({ plugin_id: plugin.id, account: conn.name, post_id, published_at: now });
      draft.updated_at = now;
      save();
      res.json({ draft });
    } catch (err) {
      res.status(err.reconnect ? 401 : 502).json({ error: err.message, needs_reconnect: Boolean(err.reconnect) });
    }
  });
}
