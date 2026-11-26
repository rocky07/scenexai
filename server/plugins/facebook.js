// Facebook Pages (Messenger) plugin. Only Pages can be read and answered through the API,
// not personal profile messages.
import crypto from 'node:crypto';
import { decrypt } from '../crypto.js';
import { getConfig, allConfigs, findByExternal } from './shared.js';

const VERSION = process.env.FB_GRAPH_VERSION || 'v23.0';
const GRAPH = `https://graph.facebook.com/${VERSION}`;

async function graph(path, { method = 'GET', token, params = {}, body } = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(`Facebook: ${data.error?.message || `request failed (${res.status})`}`);
  }
  return data;
}

const facebook = {
  id: 'facebook',
  name: 'Facebook Pages',
  description: 'Read and reply to messages on your business Pages. Needs a Meta app with the Messenger product.',
  fields: [
    { key: 'app_id', label: 'App ID' },
    { key: 'app_secret', label: 'App secret', secret: true },
    {
      key: 'verify_token',
      label: 'Webhook verify token',
      secret: true,
      help: 'Any random string. Enter the same value in the Meta webhook settings.',
    },
  ],
  capabilities: { inbox: true, webhook: true, feed: true },

  loginUrl({ config, redirectUri, state }) {
    const url = new URL(`https://www.facebook.com/${VERSION}/dialog/oauth`);
    url.searchParams.set('client_id', config.app_id);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement'].join(','));
    return url.toString();
  },

  // Trade the login code for a long-lived user token, then list the Pages it manages.
  // Subscribing each Page sends its new messages to our webhook.
  async exchange({ config, redirectUri, code }) {
    const short = await graph('oauth/access_token', {
      params: { client_id: config.app_id, client_secret: config.app_secret, redirect_uri: redirectUri, code },
    });
    const long = await graph('oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: config.app_id,
        client_secret: config.app_secret,
        fb_exchange_token: short.access_token,
      },
    });
    const { data } = await graph('me/accounts', {
      token: long.access_token,
      params: { fields: 'id,name,access_token', limit: 100 },
    });
    for (const page of data) {
      await graph(`${page.id}/subscribed_apps`, {
        method: 'POST',
        token: page.access_token,
        params: { subscribed_fields: 'messages,messaging_postbacks' },
      });
    }
    return data.map((page) => ({ external_id: page.id, name: page.name, token: page.access_token }));
  },

  inbox: {
    async conversations(conn) {
      const { data } = await graph(`${conn.external_id}/conversations`, {
        token: conn.token,
        params: { fields: 'id,updated_time,snippet,participants', limit: 25 },
      });
      return data.map((c) => ({
        id: c.id,
        updated_time: c.updated_time,
        snippet: c.snippet || '',
        // The participant who is not the Page is the customer.
        customer: (c.participants?.data || []).find((p) => p.id !== conn.external_id) || null,
      }));
    },

    async messages(conn, conversationId) {
      const { data } = await graph(`${conversationId}/messages`, {
        token: conn.token,
        params: { fields: 'id,message,from,created_time', limit: 50 },
      });
      return data.reverse().map((m) => ({
        id: m.id,
        text: m.message || '',
        from_page: m.from?.id === conn.external_id,
        created_time: m.created_time,
      }));
    },

    // Standard reply inside Meta's 24-hour window after the customer's last message.
    async reply(conn, recipientId, text) {
      const sent = await graph(`${conn.external_id}/messages`, {
        method: 'POST',
        token: conn.token,
        body: { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text } },
      });
      return { message_id: sent.message_id };
    },
  },

  // Recent Page posts with engagement, and the top comments on each. Needs pages_read_engagement.
  feed: {
    async posts(conn, limit = 25) {
      const { data } = await graph(`${conn.external_id}/posts`, {
        token: conn.token,
        params: {
          fields:
            'id,message,created_time,permalink_url,shares,reactions.summary(total_count),' +
            'comments.summary(total_count).limit(5){id,message,from,created_time}',
          limit,
        },
      });
      return data.map((post) => {
        const reactions = post.reactions?.summary?.total_count || 0;
        const comments = post.comments?.summary?.total_count || 0;
        const shares = post.shares?.count || 0;
        return {
          id: post.id,
          text: post.message || '',
          created_time: post.created_time,
          url: post.permalink_url || null,
          reactions,
          comments,
          shares,
          engagement: reactions + comments + shares,
          top_comments: (post.comments?.data || []).map((c) => ({
            id: c.id,
            text: c.message || '',
            from: c.from?.name || 'Someone',
            created_time: c.created_time,
          })),
        };
      });
    },
  },

  webhook: {
    // Meta checks the URL with a challenge. Any company's verify token can match, since one webhook URL serves all.
    verify(query) {
      if (query['hub.mode'] !== 'subscribe') return null;
      const match = allConfigs(facebook.id).some((row) => {
        const token = row.values?.verify_token;
        return token && decrypt(token) === query['hub.verify_token'];
      });
      return match ? query['hub.challenge'] : null;
    },

    // Returns true when the event was accepted. Messages are fetched by the inbox, so nothing is stored here.
    handle(body, rawBody, signature) {
      const entry = body.entry?.[0];
      const connection = entry && findByExternal(facebook.id, String(entry.id));
      if (!connection) return { ok: true, note: 'unknown page' };

      // The app secret comes from the company that owns this Page.
      const { app_secret: secret } = getConfig(connection.company_id, facebook);
      const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const valid = signature && signature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
      return { ok: valid };
    },
  },
};

export default facebook;
