import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDate } from './Search.jsx';

// Write posts as drafts, then publish a draft to one of the connected accounts for this plugin.
export default function Publish({ plugin }) {
  const [drafts, setDrafts] = useState(null);
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reconnect, setReconnect] = useState(false);
  const [target, setTarget] = useState({}); // draftId -> connection id

  const accounts = plugin.connections;

  async function load() {
    const data = await api('/drafts');
    setDrafts(data.drafts);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  function fail(err) {
    setError(err.message);
    setReconnect(Boolean(err.data?.needs_reconnect));
  }

  async function saveDraft(e) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setBusy(true);
    setError('');
    setNotice('');
    setReconnect(false);
    try {
      if (editingId) {
        await api(`/drafts/${editingId}`, { method: 'PUT', body: { text: content } });
        setNotice('Draft updated.');
      } else {
        await api('/drafts', { method: 'POST', body: { text: content } });
        setNotice('Draft saved.');
      }
      setText('');
      setEditingId(null);
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(draft) {
    setEditingId(draft.id);
    setText(draft.text);
    setNotice('');
    setError('');
  }

  async function publish(draft) {
    const connectionId = target[draft.id] || accounts[0]?.id;
    if (!connectionId) return;
    if (!window.confirm('Publish this post to LinkedIn now?')) return;
    setBusy(true);
    setError('');
    setNotice('');
    setReconnect(false);
    try {
      await api(`/drafts/${draft.id}/publish`, {
        method: 'POST',
        body: { plugin_id: plugin.id, connection_id: connectionId },
      });
      setNotice('Published.');
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(draft) {
    if (!window.confirm('Delete this draft? Posts already published stay on LinkedIn.')) return;
    try {
      await api(`/drafts/${draft.id}`, { method: 'DELETE' });
      if (editingId === draft.id) {
        setEditingId(null);
        setText('');
      }
      await load();
    } catch (err) {
      fail(err);
    }
  }

  if (drafts === null) return <div className="muted">{error || 'Loading…'}</div>;

  return (
    <section className="publish">
      {notice && <div className="success">{notice}</div>}
      {error && (
        <div className="error">
          {error}
          {reconnect && <div className="hint">Use the Setup tab to connect {plugin.name} again.</div>}
        </div>
      )}

      {accounts.length === 0 && (
        <p className="muted">Connect {plugin.name} on the Setup tab before you publish.</p>
      )}

      <form className="publish-form" onSubmit={saveDraft}>
        <h3 className="section-label-lg">{editingId ? 'Edit draft' : 'New draft'}</h3>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`What do you want to share on ${plugin.name}?`}
          rows={4}
          maxLength={3000}
          aria-label="Post text"
        />
        <div className="integration-actions">
          <span className="hint">{text.length}/3000</span>
          {editingId && (
            <button
              type="button"
              className="btn small ghost"
              onClick={() => {
                setEditingId(null);
                setText('');
              }}
            >
              Cancel
            </button>
          )}
          <button className="btn primary" disabled={busy || !text.trim()}>
            {editingId ? 'Save changes' : 'Save draft'}
          </button>
        </div>
      </form>

      <h3 className="section-label-lg">Drafts</h3>
      {drafts.length === 0 && <p className="muted">No drafts yet.</p>}
      <ul className="draft-list">
        {drafts.map((draft) => {
          const published = draft.publications.filter((p) => p.plugin_id === plugin.id);
          return (
            <li key={draft.id} className="draft-card">
              <p className="draft-text">{draft.text}</p>

              {published.map((p) => (
                <p key={p.post_id || p.published_at} className="hint">
                  Published to {p.account} on {formatDate(p.published_at)}
                </p>
              ))}

              <div className="draft-actions">
                <span className="hint">Updated {formatDate(draft.updated_at)}</span>
                <div className="draft-buttons">
                  <button className="btn small ghost" onClick={() => startEdit(draft)} disabled={busy}>
                    Edit
                  </button>
                  <button className="btn small ghost" onClick={() => remove(draft)} disabled={busy}>
                    Delete
                  </button>
                  {accounts.length > 1 && (
                    <select
                      value={target[draft.id] || accounts[0].id}
                      onChange={(e) => setTarget((t) => ({ ...t, [draft.id]: e.target.value }))}
                      aria-label="Account to publish to"
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className="btn small primary"
                    onClick={() => publish(draft)}
                    disabled={busy || accounts.length === 0}
                  >
                    Publish to {plugin.name}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
