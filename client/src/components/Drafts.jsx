import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDate } from './Search.jsx';

const SOURCE_LABEL = {
  chat: 'From chat',
  idea: 'Content idea',
  auto: 'Auto-posted',
  manual: 'Written here',
};

const targetKey = (t) => `${t.plugin_id}/${t.connection_id}`;

// All saved drafts in one place. Edit them, keep them for later, and post them to any connected account.
export default function Drafts() {
  const [drafts, setDrafts] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [chosen, setChosen] = useState({}); // draftId -> [targetKey]
  const [busyId, setBusyId] = useState('');

  async function load() {
    const [{ drafts: list }, { plugins }] = await Promise.all([api('/drafts'), api('/plugins')]);
    setDrafts(list);
    setAccounts(
      plugins
        .filter((p) => p.capabilities.publish)
        .flatMap((p) => p.connections.map((c) => ({ plugin_id: p.id, plugin_name: p.name, connection_id: c.id, name: c.name }))),
    );
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  function fail(err) {
    setNotice('');
    setError(err.message);
  }

  async function saveEdit(draft) {
    const text = editText.trim();
    if (!text) return;
    setBusyId(draft.id);
    try {
      await api(`/drafts/${draft.id}`, { method: 'PUT', body: { text } });
      setEditingId(null);
      setNotice('Draft saved.');
      setError('');
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusyId('');
    }
  }

  async function remove(draft) {
    if (!window.confirm('Delete this draft? Posts already published stay on the platform.')) return;
    try {
      await api(`/drafts/${draft.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      fail(err);
    }
  }

  async function publish(draft) {
    const keys = chosen[draft.id] || [];
    const targets = accounts.filter((a) => keys.includes(targetKey(a)));
    if (targets.length === 0) return;
    if (!window.confirm(`Publish this draft to ${targets.map((t) => `${t.plugin_name} (${t.name})`).join(', ')}?`)) return;

    setBusyId(draft.id);
    setError('');
    setNotice('');
    try {
      const { published, failures } = await api(`/drafts/${draft.id}/publish`, {
        method: 'POST',
        body: { targets: targets.map(({ plugin_id, connection_id }) => ({ plugin_id, connection_id })) },
      });
      if (published > 0) setNotice(`Published to ${published} account${published > 1 ? 's' : ''}.`);
      if (failures.length) setError(failures.map((f) => `${f.account ? `${f.account}: ` : ''}${f.message}`).join(' '));
      setChosen((c) => ({ ...c, [draft.id]: [] }));
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusyId('');
    }
  }

  function toggle(draftId, key) {
    setChosen((c) => {
      const list = c[draftId] || [];
      return { ...c, [draftId]: list.includes(key) ? list.filter((k) => k !== key) : [...list, key] };
    });
  }

  if (drafts === null) return <div className="screen muted">{error || 'Loading…'}</div>;

  return (
    <div className="screen">
      <p className="muted">
        Drafts from chat, content ideas, and auto-posts are kept here. Edit them, post them later, or post them to several accounts at once.
      </p>
      {notice && <div className="success">{notice}</div>}
      {error && <div className="error">{error}</div>}

      {drafts.length === 0 && <p className="muted">No drafts yet. Use “Save draft” on a chat reply or a content idea.</p>}

      <ul className="draft-list">
        {drafts.map((draft) => {
          const editing = editingId === draft.id;
          const keys = chosen[draft.id] || [];
          return (
            <li key={draft.id} className="draft-card">
              <div className="draft-meta">
                <span className="status-pill">{SOURCE_LABEL[draft.source] || 'Draft'}</span>
                <span className="hint">Updated {formatDate(draft.updated_at)}</span>
              </div>

              {editing ? (
                <textarea
                  className="draft-edit"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={5}
                  maxLength={3000}
                  aria-label="Draft text"
                />
              ) : (
                <p className="draft-text">{draft.text}</p>
              )}

              {draft.publications.map((p, i) => (
                <p key={`${p.post_id || i}`} className="success small-note">
                  Published to {p.account} on {formatDate(p.published_at)}
                </p>
              ))}
              {(draft.errors || []).map((e, i) => (
                <p key={i} className="error small-note">
                  {e.account ? `${e.account}: ` : ''}
                  {e.message}
                </p>
              ))}

              {editing ? (
                <div className="draft-buttons">
                  <button className="btn small ghost" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                  <button className="btn small primary" disabled={busyId === draft.id || !editText.trim()} onClick={() => saveEdit(draft)}>
                    Save changes
                  </button>
                </div>
              ) : (
                <div className="draft-actions">
                  <div className="idea-accounts">
                    {accounts.map((a) => (
                      <label key={targetKey(a)} className="idea-account">
                        <input
                          type="checkbox"
                          checked={keys.includes(targetKey(a))}
                          onChange={() => toggle(draft.id, targetKey(a))}
                        />
                        {a.plugin_name}: {a.name}
                      </label>
                    ))}
                    {accounts.length === 0 && <span className="hint">Connect LinkedIn or Facebook to publish.</span>}
                  </div>
                  <div className="draft-buttons">
                    <button
                      className="btn small ghost"
                      onClick={() => {
                        setEditingId(draft.id);
                        setEditText(draft.text);
                      }}
                    >
                      Edit
                    </button>
                    <button className="btn small ghost" onClick={() => remove(draft)}>
                      Delete
                    </button>
                    <button
                      className="btn small primary"
                      disabled={busyId === draft.id || keys.length === 0}
                      onClick={() => publish(draft)}
                    >
                      {busyId === draft.id ? 'Posting…' : 'Publish'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
