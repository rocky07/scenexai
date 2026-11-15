import { useState } from 'react';
import { api } from '../api.js';

const FIELDS = [
  {
    name: 'name',
    label: 'Company name',
    hint: 'The name your posts are written under.',
    required: true,
    rows: 1,
  },
  {
    name: 'products',
    label: 'Products and services',
    hint: 'What you sell, with prices if you want them mentioned.',
    rows: 4,
  },
  {
    name: 'brand_voice',
    label: 'Brand voice',
    hint: 'How you sound, e.g. "friendly and local, short sentences, light humour".',
    rows: 3,
  },
  {
    name: 'target_audience',
    label: 'Target audience',
    hint: 'Who you want to reach, e.g. "families within 5 km of the shop".',
    rows: 3,
  },
];

export default function Profile({ company, onSaved }) {
  const [form, setForm] = useState({
    name: company.name || '',
    products: company.products || '',
    brand_voice: company.brand_voice || '',
    target_audience: company.target_audience || '',
  });
  const [status, setStatus] = useState(null); // { type: 'ok' | 'error', text }
  const [busy, setBusy] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setStatus(null);
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const { company: saved } = await api('/company', { method: 'PUT', body: form });
      onSaved(saved);
      setStatus({ type: 'ok', text: 'Profile saved. The assistant will use it from your next message.' });
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <form className="profile" onSubmit={save}>
        <h2>Company profile</h2>
        <p className="muted">The assistant reads this before writing anything for you.</p>

        {FIELDS.map((field) => (
          <label key={field.name} className="field">
            <span className="field-label">{field.label}</span>
            <textarea
              value={form[field.name]}
              onChange={(e) => update(field.name, e.target.value)}
              rows={field.rows}
              required={field.required}
            />
            <span className="hint">{field.hint}</span>
          </label>
        ))}

        {status && <div className={status.type === 'ok' ? 'success' : 'error'}>{status.text}</div>}

        <div className="form-actions">
          <button className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>
    </div>
  );
}
