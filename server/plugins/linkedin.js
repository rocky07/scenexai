// LinkedIn plugin. Connects a LinkedIn member account with "Sign In with LinkedIn" (OpenID Connect),
// which needs no partner approval. LinkedIn's messaging API is limited to approved partners, so this
// plugin has no inbox yet.
const linkedin = {
  id: 'linkedin',
  name: 'LinkedIn',
  description: 'Connect a LinkedIn member account. Messaging access is restricted to LinkedIn partners, so there is no inbox yet.',
  fields: [
    { key: 'client_id', label: 'Client ID' },
    { key: 'client_secret', label: 'Client secret', secret: true },
  ],
  capabilities: { inbox: false, webhook: false },

  loginUrl({ config, redirectUri, state }) {
    const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.client_id);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'openid profile email');
    return url.toString();
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
