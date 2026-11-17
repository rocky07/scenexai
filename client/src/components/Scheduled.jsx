import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDate } from './Search.jsx';

const DESCRIPTIONS = {
  daily_briefing: 'What needs a reply first, what changed since yesterday, and today’s priorities.',
  weekly_review: 'What went well, what needs attention, and the three things to focus on next week.',
  content_ideas: 'Five post ideas for the coming week, each with a hook and caption, saved as drafts.',
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

export default function Scheduled({ briefingId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState('');
  const [openId, setOpenId] = useState(briefingId || null);

  async function load() {
    const next = await api('/scheduled');
    setData(next);
    return next;
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
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
            <div className="briefing-body">{opened.content}</div>
          </article>
        )}
      </section>
    </div>
  );
}

function titleFor(task) {
  return { daily_briefing: 'Daily briefing', weekly_review: 'Weekly review', content_ideas: 'Content ideas' }[task.kind];
}
