import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';

const EMPTY = { chats: [], briefings: [], plugins: [], accounts: [] };

export default function Search({ onOpenChat, onOpenBriefing, onOpenPlugin, onOpenAccount }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Wait a moment after typing before searching, so each keystroke doesn't send a request.
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults(EMPTY);
      return undefined;
    }
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(() => {
      api(`/search?q=${encodeURIComponent(term)}`)
        .then((data) => {
          if (!cancelled) setResults(data);
        })
        .catch((err) => {
          if (!cancelled) setError(err.message);
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const total = results.chats.length + results.briefings.length + results.plugins.length + results.accounts.length;
  const hasTerm = q.trim().length > 0;

  return (
    <div className="screen">
      <label className="search-box">
        <Icon name="search" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search chats, briefings, plugins and accounts"
          aria-label="Search"
        />
      </label>

      {error && <div className="error">{error}</div>}
      {hasTerm && !busy && total === 0 && <p className="muted">No results for “{q.trim()}”.</p>}
      {busy && <p className="muted">Searching…</p>}

      {results.chats.length > 0 && (
        <ResultGroup title="Chats">
          {results.chats.map((c) => (
            <ResultRow key={c.id} title={c.title} meta={formatDate(c.updated_at)} onClick={() => onOpenChat(c.id)} />
          ))}
        </ResultGroup>
      )}

      {results.briefings.length > 0 && (
        <ResultGroup title="Briefings">
          {results.briefings.map((b) => (
            <ResultRow key={b.id} title={b.title} meta={formatDate(b.created_at)} onClick={() => onOpenBriefing(b.id)} />
          ))}
        </ResultGroup>
      )}

      {results.accounts.length > 0 && (
        <ResultGroup title="Accounts">
          {results.accounts.map((a) => (
            <ResultRow
              key={`${a.plugin_id}-${a.id}`}
              title={a.name}
              meta={a.plugin_name}
              onClick={() => onOpenAccount(a.plugin_id)}
            />
          ))}
        </ResultGroup>
      )}

      {results.plugins.length > 0 && (
        <ResultGroup title="Plugins">
          {results.plugins.map((p) => (
            <ResultRow key={p.id} title={p.name} meta="Plugin" onClick={() => onOpenPlugin(p.id)} />
          ))}
        </ResultGroup>
      )}
    </div>
  );
}

function ResultGroup({ title, children }) {
  return (
    <section className="result-group">
      <h3 className="section-label-lg">{title}</h3>
      <div className="result-list">{children}</div>
    </section>
  );
}

function ResultRow({ title, meta, onClick }) {
  return (
    <button className="result-row" onClick={onClick}>
      <span className="result-title">{title}</span>
      <span className="muted result-meta">{meta}</span>
    </button>
  );
}

export function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}
