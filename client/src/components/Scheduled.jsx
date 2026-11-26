import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDate } from './Search.jsx';

const DESCRIPTIONS = {
  daily_briefing: 'What needs a reply first, what changed since yesterday, and today’s priorities.',
  weekly_review: 'What went well, what needs attention, and the three things to focus on next week.',
  content_ideas: 'Three ready-to-post ideas for the coming week. Post them now, or turn on auto-post.',
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
const targetKey = (t) => `${t.plugin_id}/${t.connection_id}`;

export default function Scheduled({ briefingId }) {
  const [data, setData] = useState(null);
  const [accounts, setAccounts] = useState([]); // accounts that can publish
  const [error, setError] = useState('');
  const [running, setRunning] = useState('');
  const [openId, setOpenId] = useState(briefingId || null);

  async function load() {
    const next = await api('/scheduled');
    setData(next);
    return next;
  }

  async function loadAccounts() {
    const { plugins } = await api('/plugins');
    setAccounts(
      plugins
        .filter((p) => p.capabilities.publish)
        .flatMap((p) => p.connections.map((c) => ({ plugin_id: p.id, plugin_name: p.name, connection_id: c.id, name: c.name }))),
    );
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
    loadAccounts().catch((err) => setError(err.message));
  }, []);

  async function update(task, changes) {
    setError('');
    try {
      await api(`/scheduled/${task.id}`, { method: 'PUT', body: changes });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function runNow(task) {
    setRunning(task.id);
    setError('');
    try {
      const { briefing } = await api(`/scheduled/${task.id}/run`, { method: 'POST' });
      await load();
      setOpenId(briefing.id);
    } catch (err) {
      setError(err.message);
      await load().catch(() => {});
    } finally {
      setRunning('');
    }
  }

  if (!data) return <div className="screen muted">{error || 'Loading…'}</div>;

  const opened = data.briefings.find((b) => b.id === openId) || null;

  return (
    <div className="screen">
      <p className="muted">Briefings are written on a schedule from your company profile, connected accounts and recent chats.</p>
      {error && <div className="error">{error}</div>}

      <AutoPostCard accounts={accounts} initial={data.auto_post} onError={setError} />

      <div className="task-grid">
        {data.tasks.map((task) => (
          <section key={task.id} className={`task-card ${task.enabled ? '' : 'paused'}`}>
            <div className="task-head">
              <div>
                <h2>{titleFor(task)}</h2>
                <p className="muted">{DESCRIPTIONS[task.kind]}</p>
              </div>
              <button
                className={`switch ${task.enabled ? 'on' : ''}`}
                aria-pressed={task.enabled}
                aria-label={`${task.enabled ? 'Pause' : 'Resume'} ${titleFor(task)}`}
                onClick={() => update(task, { enabled: !task.enabled })}
              >
                <span />
              </button>
            </div>

            <div className="task-schedule">
              <label>
                Time
                <select value={task.hour} onChange={(e) => update(task, { hour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
              {task.frequency === 'weekly' && (
                <label>
                  Day
                  <select value={task.weekday} onChange={(e) => update(task, { weekday: Number(e.target.value) })}>
                    {DAYS.map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="task-foot">
              <span className="hint">
                {task.enabled ? `Next: ${formatDate(task.next_run_at)}` : 'Paused'}
                {task.last_run_at && ` · Last run: ${formatDate(task.last_run_at)}`}
              </span>
              <button className="btn small" disabled={running === task.id} onClick={() => runNow(task)}>
                {running === task.id ? 'Writing…' : 'Run now'}
              </button>
            </div>
            {task.note && <p className="hint">{task.note}</p>}
            {task.last_error && <div className="error small-error">Last run failed: {task.last_error}</div>}
          </section>
        ))}
      </div>

      <section className="briefings">
        <h2>Briefings</h2>
        {data.briefings.length === 0 && <p className="muted">Nothing yet. Run a task to create the first one.</p>}
        <div className="briefing-list">
          {data.briefings.map((b) => (
            <button
              key={b.id}
              className={`result-row ${b.id === openId ? 'active' : ''}`}
              onClick={() => setOpenId(b.id)}
            >
              <span className="result-title">{b.title}</span>
              <span className="muted result-meta">{formatDate(b.created_at)}</span>
            </button>
          ))}
        </div>

        {opened && (
          <article className="briefing-view">
            <header>
              <strong>{opened.title}</strong>
              <span className="muted">
                {formatDate(opened.created_at)} · {opened.provider === 'claude' ? 'Claude' : 'Local AI'}
              </span>
            </header>

            {opened.posts?.length > 0 ? (
              <div className="idea-list">
                {opened.posts.map((post, index) => (
                  <IdeaPost key={`${opened.id}-${index}`} briefingId={opened.id} index={index} post={post} accounts={accounts} />
                ))}
              </div>
            ) : (
              <div className="briefing-body">{opened.content}</div>
            )}
          </article>
        )}
      </section>
    </div>
  );
}

// One content idea with a Post button for each chosen account.
function IdeaPost({ briefingId, index, post, accounts }) {
  const [chosen, setChosen] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  function toggle(key) {
    setChosen((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
  }

  async function postNow() {
    const targets = accounts.filter((a) => chosen.includes(targetKey(a)));
    if (targets.length === 0) return;
    if (!window.confirm(`Post this to ${targets.map((t) => `${t.plugin_name} (${t.name})`).join(', ')}?`)) return;
    setBusy(true);
    setResult(null);
    try {
      const { draft } = await api(`/briefings/${briefingId}/posts/${index}/publish`, {
        method: 'POST',
        body: { targets: targets.map(({ plugin_id, connection_id }) => ({ plugin_id, connection_id })) },
      });
      setResult(draft);
    } catch (err) {
      setResult({ errors: [{ account: '', message: err.message }], publications: [] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="idea">
      <strong>{post.hook}</strong>
      <p className="idea-text">{post.text}</p>

      {accounts.length === 0 ? (
        <p className="hint">Connect LinkedIn or Facebook on the Plugins page to post this.</p>
      ) : (
        <div className="idea-actions">
          <div className="idea-accounts">
            {accounts.map((a) => (
              <label key={targetKey(a)} className="idea-account">
                <input type="checkbox" checked={chosen.includes(targetKey(a))} onChange={() => toggle(targetKey(a))} />
                {a.plugin_name}: {a.name}
              </label>
            ))}
          </div>
          <button className="btn small primary" disabled={busy || chosen.length === 0} onClick={postNow}>
            {busy ? 'Posting…' : 'Post now'}
          </button>
        </div>
      )}

      {result && (
        <div className="idea-result">
          {result.publications.map((p) => (
            <p key={`${p.plugin_id}-${p.account}`} className="success">
              Posted to {p.account}
            </p>
          ))}
          {result.errors.map((e, i) => (
            <p key={i} className="error">
              {e.account ? `${e.account}: ` : ''}
              {e.message}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

// Auto-post: when on, new content ideas are posted to the accounts chosen here, up to 3 per run.
function AutoPostCard({ accounts, initial, onError }) {
  const [enabled, setEnabled] = useState(Boolean(initial?.enabled));
  const [chosen, setChosen] = useState(initial?.targets?.map(targetKey) || []);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setEnabled(Boolean(initial?.enabled));
    setChosen(initial?.targets?.map(targetKey) || []);
  }, [initial]);

  function toggle(key) {
    setChosen((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
  }

  async function save(nextEnabled) {
    const targets = accounts.filter((a) => chosen.includes(targetKey(a)));
    if (nextEnabled && targets.length === 0) {
      setMessage('Choose at least one account first.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await api('/auto-post', {
        method: 'PUT',
        body: {
          enabled: nextEnabled,
          targets: targets.map(({ plugin_id, connection_id }) => ({ plugin_id, connection_id })),
        },
      });
      setEnabled(nextEnabled);
      setMessage(nextEnabled ? 'Auto-post is on.' : 'Auto-post is off.');
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (accounts.length === 0) return null;

  return (
    <section className="autopost">
      <div className="task-head">
        <div>
          <h2>Auto-post content ideas</h2>
          <p className="muted">
            When on, each new set of content ideas is published to the accounts below without waiting for approval,
            up to 3 posts per run. Review ideas before turning this on. Turn it off at any time.
          </p>
        </div>
        <span className={`status-pill ${enabled ? 'on' : ''}`}>{enabled ? 'On' : 'Off'}</span>
      </div>

      <div className="idea-accounts">
        {accounts.map((a) => (
          <label key={targetKey(a)} className="idea-account">
            <input type="checkbox" checked={chosen.includes(targetKey(a))} onChange={() => toggle(targetKey(a))} />
            {a.plugin_name}: {a.name}
          </label>
        ))}
      </div>

      <div className="integration-actions">
        {message && <span className="hint">{message}</span>}
        <button className="btn" disabled={saving} onClick={() => save(false)}>
          Turn off
        </button>
        <button className="btn primary" disabled={saving} onClick={() => save(true)}>
          {enabled ? 'Save accounts' : 'Turn on auto-post'}
        </button>
      </div>
    </section>
  );
}

function titleFor(task) {
  return { daily_briefing: 'Daily briefing', weekly_review: 'Weekly review', content_ideas: 'Content ideas' }[task.kind];
}
