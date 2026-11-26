import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDate } from './Search.jsx';

// Scenex AI staff only: create customer companies and logins, set each company's Anthropic key,
// and switch companies, users, and auto-post on or off.
export default function Admin() {
  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    const data = await api('/admin/companies');
    setCompanies(data.companies);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  // Runs one change, then refreshes the list. Shows the server's message on failure.
  async function run(action, success) {
    setError('');
    setNotice('');
    try {
      await action();
      await load();
      if (success) setNotice(success);
    } catch (err) {
      setError(err.message);
    }
  }

  if (companies === null) return <div className="screen muted">{error || 'Loading…'}</div>;

  return (
    <div className="screen">
      <p className="muted">
        Manage customer companies. Each company gets its own login and Anthropic key. Keys are stored encrypted and never shown
        again.
      </p>
      {notice && <div className="success">{notice}</div>}
      {error && <div className="error">{error}</div>}

      <NewCompany onCreated={() => run(async () => {}, 'Company created.')} onError={setError} onSaved={load} />

      {companies.map((company) => (
        <CompanyCard key={company.id} company={company} run={run} />
      ))}
      {companies.length === 0 && <p className="muted">No companies yet.</p>}
    </div>
  );
}

function NewCompany({ onCreated, onError, onSaved }) {
  const [form, setForm] = useState({ name: '', owner_name: '', owner_email: '', owner_password: '' });
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    onError('');
    try {
      await api('/admin/companies', { method: 'POST', body: form });
      setForm({ name: '', owner_name: '', owner_email: '', owner_password: '' });
      await onSaved();
      onCreated();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="task-card" onSubmit={submit}>
      <h2>New company</h2>
      <div className="admin-grid">
        <label>
          Company name
          <input value={form.name} onChange={set('name')} required />
        </label>
        <label>
          First user’s name
          <input value={form.owner_name} onChange={set('owner_name')} required />
        </label>
        <label>
          First user’s email
          <input type="email" value={form.owner_email} onChange={set('owner_email')} required />
        </label>
        <label>
          Temporary password (8+ characters)
          <input type="password" value={form.owner_password} onChange={set('owner_password')} required minLength={8} />
        </label>
      </div>
      <div className="integration-actions">
        <button className="btn primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create company'}
        </button>
      </div>
    </form>
  );
}

function CompanyCard({ company, run }) {
  const [keyInput, setKeyInput] = useState('');
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' });
  const [resetFor, setResetFor] = useState(null);
  const [resetPassword, setResetPassword] = useState('');

  const patch = (body, success) => run(() => api(`/admin/companies/${company.id}`, { method: 'PUT', body }), success);

  return (
    <section className={`task-card ${company.active ? '' : 'paused'}`}>
      <div className="task-head">
        <div>
          <h2>{company.name}</h2>
          <p className="muted">Created {formatDate(company.created_at)}</p>
        </div>
        <span className={`status-pill ${company.active ? 'on' : ''}`}>{company.active ? 'Active' : 'Disabled'}</span>
      </div>

      <div className="admin-toggles">
        <Toggle
          label="Company active"
          on={company.active}
          onChange={() => patch({ active: !company.active }, company.active ? 'Company disabled.' : 'Company enabled.')}
        />
        <Toggle
          label="Auto-post allowed"
          on={company.auto_post_allowed}
          onChange={() =>
            patch(
              { auto_post_allowed: !company.auto_post_allowed },
              company.auto_post_allowed ? 'Auto-post turned off for this company.' : 'Auto-post allowed for this company.',
            )
          }
        />
      </div>

      <div className="admin-section">
        <h3 className="section-label-lg">Anthropic API key</h3>
        <p className="hint">
          {company.has_anthropic_key
            ? `Key set, ending in ${company.anthropic_key_hint}.`
            : 'No key. Claude uses the platform key from the server settings, if one is set.'}
        </p>
        <form
          className="admin-inline"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => api(`/admin/companies/${company.id}/anthropic-key`, { method: 'PUT', body: { api_key: keyInput } }),
              'Key saved.',
            ).then(() => setKeyInput(''));
          }}
        >
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={company.has_anthropic_key ? 'Enter a new key to replace it' : 'sk-ant-…'}
            autoComplete="off"
            aria-label="Anthropic API key"
          />
          <button className="btn small primary" disabled={!keyInput.trim()}>
            Save key
          </button>
          {company.has_anthropic_key && (
            <button
              type="button"
              className="btn small ghost"
              onClick={() => {
                if (window.confirm('Remove this company’s Anthropic key?')) {
                  run(
                    () => api(`/admin/companies/${company.id}/anthropic-key`, { method: 'PUT', body: { api_key: '' } }),
                    'Key removed.',
                  );
                }
              }}
            >
              Remove key
            </button>
          )}
        </form>
      </div>

      <div className="admin-section">
        <h3 className="section-label-lg">Logins</h3>
        <ul className="connection-list">
          {company.users.map((user) => (
            <li key={user.id} className="admin-user">
              <div>
                <strong>{user.name}</strong> <span className="muted">{user.email}</span>
                {user.role === 'admin' && <span className="status-pill on admin-tag">Scenex admin</span>}
                {!user.active && <span className="status-pill admin-tag">Disabled</span>}
              </div>
              <div className="draft-buttons">
                {resetFor === user.id ? (
                  <form
                    className="admin-inline"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(
                        () => api(`/admin/users/${user.id}`, { method: 'PUT', body: { password: resetPassword } }),
                        'Password reset.',
                      ).then(() => {
                        setResetFor(null);
                        setResetPassword('');
                      });
                    }}
                  >
                    <input
                      type="password"
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      placeholder="New password"
                      aria-label="New password"
                      minLength={8}
                    />
                    <button className="btn small primary" disabled={resetPassword.length < 8}>
                      Set
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => setResetFor(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button className="btn small ghost" onClick={() => setResetFor(user.id)}>
                    Reset password
                  </button>
                )}
                <button
                  className="btn small ghost"
                  onClick={() =>
                    run(
                      () => api(`/admin/users/${user.id}`, { method: 'PUT', body: { active: !user.active } }),
                      user.active ? 'Login disabled.' : 'Login enabled.',
                    )
                  }
                >
                  {user.active ? 'Disable' : 'Enable'}
                </button>
              </div>
            </li>
          ))}
        </ul>

        <form
          className="admin-inline"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => api(`/admin/companies/${company.id}/users`, { method: 'POST', body: newUser }),
              'Login added.',
            ).then(() => setNewUser({ name: '', email: '', password: '' }));
          }}
        >
          <input
            placeholder="Name"
            value={newUser.name}
            onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
            aria-label="New user name"
          />
          <input
            type="email"
            placeholder="Email"
            value={newUser.email}
            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
            aria-label="New user email"
          />
          <input
            type="password"
            placeholder="Password (8+)"
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            aria-label="New user password"
          />
          <button className="btn small" disabled={!newUser.name || !newUser.email || newUser.password.length < 8}>
            Add login
          </button>
        </form>
      </div>
    </section>
  );
}

function Toggle({ label, on, onChange }) {
  return (
    <label className="admin-toggle">
      <button className={`switch ${on ? 'on' : ''}`} aria-pressed={on} aria-label={label} onClick={onChange} type="button">
        <span />
      </button>
      <span>{label}</span>
    </label>
  );
}
