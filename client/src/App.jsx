import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import Login from './components/Login.jsx';
import Shell from './components/Shell.jsx';

export default function App() {
  // 'loading' while checking an existing session, then 'out' or 'in'.
  const [status, setStatus] = useState(getToken() ? 'loading' : 'out');
  const [session, setSession] = useState(null); // { user, company }

  useEffect(() => {
    if (status !== 'loading') return;
    api('/me')
      .then((data) => {
        setSession(data);
        setStatus('in');
      })
      .catch(() => {
        setToken(null);
        setStatus('out');
      });
  }, [status]);

  function handleLogin(data) {
    setToken(data.token);
    setSession({ user: data.user, company: data.company });
    setStatus('in');
  }

  async function handleLogout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setToken(null);
      setSession(null);
      setStatus('out');
    }
  }

  if (status === 'loading') return <div className="splash">Loading…</div>;
  if (status === 'out') return <Login onLogin={handleLogin} />;

  return (
    <Shell
      session={session}
      onCompanyChange={(company) => setSession((s) => ({ ...s, company }))}
      onLogout={handleLogout}
    />
  );
}
