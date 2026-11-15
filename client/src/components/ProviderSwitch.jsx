import { useState } from 'react';

// Dropdown in the composer, like the model picker on claude.ai.
export default function ProviderSwitch({ providers, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const current = providers.find((p) => p.id === value);

  function pick(id) {
    onChange(id);
    setOpen(false);
  }

  return (
    <div className="provider-switch">
      <button type="button" className="pill" onClick={() => setOpen((o) => !o)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}>
        <span className={`dot ${current?.available ? 'on' : 'off'}`} />
        {current ? `${current.label}` : 'Loading…'}
        {current && <span className="pill-model">{current.model}</span>}
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <ul className="menu" role="listbox">
            {providers.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === value}
                  className={`menu-item ${p.id === value ? 'selected' : ''}`}
                  disabled={!p.available}
                  onClick={() => pick(p.id)}
                >
                  <span className="menu-title">
                    <span className={`dot ${p.available ? 'on' : 'off'}`} />
                    {p.label}
                  </span>
                  <span className="menu-sub">
                    {p.model} · {p.available ? (p.id === 'local' ? 'Running on your server' : 'Anthropic API') : p.id === 'local' ? 'Offline: start Ollama' : 'Set ANTHROPIC_API_KEY'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
