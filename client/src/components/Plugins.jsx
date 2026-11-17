import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import Inbox from './Inbox.jsx';

const NOTICES = {
  connected: 'Account connected.',
  denied: 'Connection cancelled on the other site.',
  expired: 'That connection link expired. Try again.',
  failed: 'Could not connect. Check the server log and your app settings.',
};

const BRAND = {
  facebook: { color: '#1877F2', letter: 'f' },
  linkedin: { color: '#0A66C2', letter: 'in' },
};

// Plugins list (Claude-style grid with filters), or one plugin's detail page when pluginId is set.
export default function Plugins({ pluginId, tab, onNavigate }) {
  const [plugins, setPlugins] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');

  // The login redirect comes back with ?plugin=...&status=... Show the result once, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('plugin')) return;
    const key = params.get('status') === 'connected' ? 'connected' : params.get('reason') || 'failed';
    setNotice(NOTICES[key] || NOTICES.failed);
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  async function load() {
    const data = await api('/plugins');
    setPlugins(data.plugins);
    return data.plugins;
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  if (plugins === null) return <div className="screen muted">{error || 'Loading…'}</div>;

  if (pluginId) {
    const plugin = plugins.find((p) => p.id === pluginId);
    if (!plugin) return <div className="screen"><div className="error">Unknown integration.</div></div>;
    return (
      <PluginDetail
        plugin={plugin}
        initialTab={tab}
        notice={notice}
        onChange={load}
        onBack={() => onNavigate({ name: 'plugins' })}
      />
    );
  }

  const term = q.trim().toLowerCase();
  const visible = plugins.filter((p) => {
    if (filter === 'connected' && p.connections.length === 0) return false;
    if (filter === 'available' && p.connections.length > 0) return false;
    return !term || p.name.toLowerCase().includes(term) || p.description.toLowerCase().includes(term);
  });

  return (
    <div className="screen">
      {notice && <div className="success">{notice}</div>}
      {error && <div className="error">{error}</div>}

      <div className="plugins-toolbar">
        <label className="search-box">
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plugins" aria-label="Search plugins" />
        </label>
        <div className="segmented" role="tablist">
          {[
            ['all', 'All'],
            ['connected', 'Connected'],
            ['available', 'Available'],
          ].map(([key, label]) => (
            <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="plugin-grid">
        {visible.map((plugin) => (
          <button
            key={plugin.id}
            className="plugin-card"
            onClick={() => onNavigate({ name: 'plugins', pluginId: plugin.id })}
          >
            <PluginIcon id={plugin.id} name={plugin.name} />
            <div className="plugin-card-body">
              <div className="plugin-card-title">
                <span>{plugin.name}</span>
                {plugin.connections.length > 0 && <span className="status-pill on">Connected</span>}
              </div>
              <p className="muted">{plugin.description}</p>
              <span className="hint">Integration · By Scenex AI</span>
            </div>
          </button>
        ))}
        {visible.length === 0 && <p className="muted">No plugins match.</p>}
      </div>
    </div>
  );
}

function PluginIcon({ id, name }) {
  const brand = BRAND[id] || { color: 'var(--accent)', letter: name.charAt(0) };
  return (
    <span className="plugin-icon" style={{ background: brand.color }} aria-hidden="true">
      {brand.letter}
    </span>
  );
}

function PluginDetail({ plugin, initialTab, notice, onChange, onBack }) {
  const [tab, setTab] = useState(initialTab === 'inbox' && plugin.capabilities.inbox ? 'inbox' : 'setup');
  const hasInbox = plugin.capabilities.inbox;

  return (
    <div className="screen">
      <button className="btn ghost small back" onClick={onBack}>
        ← All plugins
      </button>

      <header className="plugin-detail-head">
        <PluginIcon id={plugin.id} name={plugin.name} />
        <div>
          <h2>{plugin.name}</h2>
          <p className="muted">{plugin.description}</p>
        </div>
        <span className={`status-pill ${plugin.configured ? 'on' : ''}`}>
          {plugin.configured ? 'Ready' : 'Setup needed'}
        </span>
      </header>

      {notice && <div className="success">{notice}</div>}

      {hasInbox && (
        <div className="segmented" role="tablist">
          <button className={tab === 'setup' ? 'active' : ''} onClick={() => setTab('setup')}>
            Setup
          </button>
          <button className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}>
            Inbox
          </button>
        </div>
      )}

      {tab === 'setup' && <Setup plugin={plugin} onChange={onChange} />}
      {tab === 'inbox' && hasInbox && <Inbox pluginId={plugin.id} />}
    </div>
  );
}

function Setup({ plugin, onChange }) {
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api(`/plugins/${plugin.id}/config`, { method: 'PUT', body: values });
      setValues({});
      setMessage('Settings saved.');
      await onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function connect() {
    setConnecting(true);
    setError('');
    try {
      const data = await api(`/plugins/${plugin.id}/connect`);
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
      setConnecting(false);
    }
  }

  async function disconnect(connectionId, name) {
    if (!window.confirm(`Disconnect ${name}?`)) return;
    try {
      await api(`/plugins/${plugin.id}/connections/${connectionId}`, { method: 'DELETE' });
      await onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="setup">
      {error && <div className="error">{error}</div>}

      <form className="integration-form" onSubmit={save}>
        <h3 className="section-label-lg">App settings</h3>
        {plugin.fields.map((field) => (
          <label key={field.key}>
            {field.label}
            <input
              type={field.secret ? 'password' : 'text'}
              value={values[field.key] ?? (field.secret ? '' : field.value)}
              placeholder={field.secret && field.is_set ? 'Saved. Leave blank to keep.' : ''}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              autoComplete="off"
            />
            {field.help && <span className="hint">{field.help}</span>}
          </label>
        ))}

        {plugin.redirect_uri && (
          <p className="hint">
            Register this redirect URI in the {plugin.name} app settings: <code>{plugin.redirect_uri}</code>
          </p>
        )}

        <div className="integration-actions">
          {message && <span className="hint">{message}</span>}
          <button className="btn" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          <button type="button" className="btn primary" onClick={connect} disabled={!plugin.configured || connecting}>
            {connecting ? 'Opening…' : `Connect ${plugin.name}`}
          </button>
        </div>
      </form>

      <h3 className="section-label-lg">Connected accounts</h3>
      {plugin.connections.length === 0 ? (
        <p className="muted">No accounts connected yet.</p>
      ) : (
        <ul className="connection-list">
          {plugin.connections.map((c) => (
            <li key={c.id}>
              <span>{c.name}</span>
              <button className="btn small ghost" onClick={() => disconnect(c.id, c.name)}>
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
