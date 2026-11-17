// Generic routes for integration plugins. Each plugin declares its config fields and optional inbox and webhook.
import crypto from 'node:crypto';
import { plugins, pluginById as byId } from './plugins/index.js';
import { encryptionReady } from './crypto.js';
import {
  publicConfig,
  isConfigured,
  getConfig,
  saveConfig,
  connectionsFor,
  publicConnection,
  addConnections,
  removeConnection,
  connectionWithToken,
} from './plugins/shared.js';

const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || '').replace(/\/$/, '');
const FRONTEND_URL = process.env.FRONTEND_URL || (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_REPLY_CHARS = 2000;

// Login "state" values, kept in memory. They only need to survive the login redirect.
const pendingLogins = new Map();

const redirectUriFor = (plugin) => `${PUBLIC_API_URL}/api/plugins/${plugin.id}/callback`;

function summary(companyId, plugin) {
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    capabilities: plugin.capabilities,
    configured: isConfigured(companyId, plugin),
    fields: publicConfig(companyId, plugin),
    redirect_uri: PUBLIC_API_URL ? redirectUriFor(plugin) : null,
    connections: connectionsFor(companyId, plugin.id).map(publicConnection),
  };
}

export function mountPlugins(app, requireAuth) {
  // Routes that call the external service need the encryption key and the plugin's own config.
  const needsSetup = (plugin) => (req, res, next) => {
    if (!encryptionReady()) return res.status(503).json({ error: 'ENCRYPTION_KEY is not set on the server.' });
    if (!PUBLIC_API_URL) return res.status(503).json({ error: 'PUBLIC_API_URL is not set on the server.' });
    if (!isConfigured(req.company.id, plugin)) {
      return res.status(400).json({ error: `Save the ${plugin.name} settings first.` });
    }
    next();
  };

  const pluginOr404 = (req, res) => {
    const plugin = byId(req.params.pluginId);
    if (!plugin) res.status(404).json({ error: 'Unknown integration.' });
    return plugin;
  };

  app.get('/api/plugins', requireAuth, (req, res) => {
    res.json({ plugins: plugins.map((p) => summary(req.company.id, p)) });
  });

  app.put('/api/plugins/:pluginId/config', requireAuth, (req, res) => {
    const plugin = pluginOr404(req, res);
    if (!plugin) return;
    if (!encryptionReady()) return res.status(503).json({ error: 'ENCRYPTION_KEY is not set on the server.' });
    try {
      saveConfig(req.company.id, plugin, req.body || {});
      res.json({ plugin: summary(req.company.id, plugin) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/plugins/:pluginId/connect', requireAuth, (req, res, next) => {
    const plugin = pluginOr404(req, res);
    if (!plugin) return;
    needsSetup(plugin)(req, res, () => {
      const state = crypto.randomBytes(24).toString('hex');
      pendingLogins.set(state, { companyId: req.company.id, pluginId: plugin.id, expires: Date.now() + STATE_TTL_MS });
      const config = getConfig(req.company.id, plugin);
      res.json({ url: plugin.loginUrl({ config, redirectUri: redirectUriFor(plugin), state }) });
    });
  });

  // The service redirects the browser here, so there is no session header. The state value is the check.
  app.get('/api/plugins/:pluginId/callback', async (req, res) => {
    const plugin = byId(req.params.pluginId);
    const back = (params) => res.redirect(`${FRONTEND_URL}/?${new URLSearchParams({ plugin: req.params.pluginId, ...params })}`);
    if (!plugin) return res.redirect(`${FRONTEND_URL}/`);

    const pending = pendingLogins.get(req.query.state);
    pendingLogins.delete(req.query.state);
    if (!pending || pending.pluginId !== plugin.id || pending.expires < Date.now()) {
      return back({ status: 'error', reason: 'expired' });
    }
    if (req.query.error || !req.query.code) return back({ status: 'error', reason: 'denied' });

    try {
      const config = getConfig(pending.companyId, plugin);
      const accounts = await plugin.exchange({ config, redirectUri: redirectUriFor(plugin), code: req.query.code });
      addConnections(pending.companyId, plugin, accounts);
      back({ status: 'connected', count: String(accounts.length) });
    } catch (err) {
      console.error(`${plugin.name} connect failed:`, err.message);
      back({ status: 'error', reason: 'failed' });
    }
  });

  app.delete('/api/plugins/:pluginId/connections/:connectionId', requireAuth, (req, res) => {
    const plugin = pluginOr404(req, res);
    if (!plugin) return;
    removeConnection(req.company.id, plugin.id, req.params.connectionId);
    res.json({ ok: true });
  });

  // ---- Inbox (plugins that declare capabilities.inbox) ----

  const inboxConnection = (req, res) => {
    const plugin = pluginOr404(req, res);
    if (!plugin) return null;
    if (!plugin.capabilities.inbox) {
      res.status(404).json({ error: `${plugin.name} has no inbox.` });
      return null;
    }
    const conn = connectionWithToken(req.company.id, plugin.id, req.params.connectionId);
    if (!conn) {
      res.status(404).json({ error: 'Account not found.' });
      return null;
    }
    return { plugin, conn };
  };

  app.get('/api/plugins/:pluginId/connections/:connectionId/conversations', requireAuth, async (req, res) => {
    const own = inboxConnection(req, res);
    if (!own) return;
    try {
      res.json({ conversations: await own.plugin.inbox.conversations(own.conn) });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.get('/api/plugins/:pluginId/connections/:connectionId/conversations/:conversationId/messages', requireAuth, async (req, res) => {
    const own = inboxConnection(req, res);
    if (!own) return;
    try {
      res.json({ messages: await own.plugin.inbox.messages(own.conn, req.params.conversationId) });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/plugins/:pluginId/connections/:connectionId/reply', requireAuth, async (req, res) => {
    const own = inboxConnection(req, res);
    if (!own) return;
    const text = String(req.body.text || '').trim();
    const recipientId = String(req.body.recipient_id || '');
    if (!text) return res.status(400).json({ error: 'Reply is empty.' });
    if (text.length > MAX_REPLY_CHARS) return res.status(400).json({ error: `Replies are limited to ${MAX_REPLY_CHARS} characters.` });
    if (!recipientId) return res.status(400).json({ error: 'Choose a conversation to reply to.' });
    try {
      res.json(await own.plugin.inbox.reply(own.conn, recipientId, text));
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // ---- Webhooks (plugins that declare capabilities.webhook) ----

  app.get('/api/plugins/:pluginId/webhook', (req, res) => {
    const plugin = pluginOr404(req, res);
    if (!plugin?.webhook) return;
    const challenge = plugin.webhook.verify(req.query);
    if (challenge === null) return res.sendStatus(403);
    res.status(200).send(challenge);
  });

  app.post('/api/plugins/:pluginId/webhook', (req, res) => {
    const plugin = pluginOr404(req, res);
    if (!plugin?.webhook) return;
    const signature = req.get('x-hub-signature-256') || '';
    const result = plugin.webhook.handle(req.body, req.rawBody || Buffer.alloc(0), signature);
    res.sendStatus(result.ok ? 200 : 401);
  });
}
