// LinkedIn plugin. Connects a LinkedIn member account with "Sign In with LinkedIn" (OpenID Connect) and
// "Share on LinkedIn" (w_member_social), which lets the app publish posts as that member.
// LinkedIn's messaging API is limited to approved partners, so there is no inbox.
const VERSION = process.env.LINKEDIN_API_VERSION || '202611'; // LinkedIn-Version header, YYYYMM; must be an active version

// Thrown when LinkedIn no longer accepts the saved login, so the UI can ask the person to reconnect.
export class ReconnectError extends Error {
  constructor(message) {
    super(message);
    this.reconnect = true;
  }
}

// Fallback for apps that the Posts API refuses (403). Uses the older ugcPosts endpoint.
async function publishWithShareApi(conn, text) {
  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${conn.token}`,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      author: `urn:li:person:${conn.external_id}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) {
    throw new ReconnectError('LinkedIn rejected the saved login. Reconnect LinkedIn on the Setup tab.');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LinkedIn: publish failed (${res.status}) ${detail.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => ({}));
  return { post_id: data.id || res.headers.get('x-restli-id') };
}

const linkedin = {
  id: 'linkedin',
  name: 'LinkedIn',
  description: 'Connect a LinkedIn member account to publish posts from Scenex AI. Messaging access is restricted to LinkedIn partners, so there is no inbox.',
  fields: [
    { key: 'client_id', label: 'Client ID' },
    { key: 'client_secret', label: 'Client secret', secret: true },
  ],
  capabilities: { inbox: false, webhook: false, publish: true },

  loginUrl({ config, redirectUri, state }) {
    const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.client_id);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'openid profile email w_member_social');
    return url.toString();
  },

  // Publishes a text post as the connected member. Returns LinkedIn's id for the new post.
  async publish(conn, text) {
    if (conn.expires_at && new Date(conn.expires_at) <= new Date()) {
      throw new ReconnectError('LinkedIn access has expired. Reconnect LinkedIn on the Setup tab.');
    }

    const res = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.token}`,
        'LinkedIn-Version': VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        author: `urn:li:person:${conn.external_id}`,
        commentary: text,
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (res.status === 401) {
      throw new ReconnectError('LinkedIn rejected the saved login. Reconnect LinkedIn on the Setup tab.');
    }
    if (res.status === 403) {
      // The Posts API is limited for some apps. The older share endpoint works with w_member_social alone.
      return publishWithShareApi(conn, text);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`LinkedIn: publish failed (${res.status}) ${detail.slice(0, 200)}`);
    }
    return { post_id: res.headers.get('x-restli-id') };
  },

  async exchange({ config, redirectUri, code }) {
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: config.client_id,
        client_secret: config.client_secret,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const token = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !token.access_token) {
      throw new Error(`LinkedIn: ${token.error_description || `token request failed (${tokenRes.status})`}`);
    }

    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const profile = await profileRes.json().catch(() => ({}));
    if (!profileRes.ok) throw new Error(`LinkedIn: profile request failed (${profileRes.status})`);

    return [
      {
        external_id: profile.sub,
        name: profile.name || profile.email || 'LinkedIn member',
        token: token.access_token,
        expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
      },
    ];
  },
};

export default linkedin;
