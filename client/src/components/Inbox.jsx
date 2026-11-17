import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

// Reads and replies to conversations on every connected account whose integration has an inbox.
export default function Inbox({ pluginId }) {
  const [accounts, setAccounts] = useState(null);
  const [selected, setSelected] = useState(''); // "pluginId/connectionId"
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const loadAccounts = useCallback(async () => {
    const data = await api('/plugins');
    const list = data.plugins
      .filter((p) => p.capabilities.inbox && (!pluginId || p.id === pluginId))
      .flatMap((p) => p.connections.map((c) => ({ key: `${p.id}/${c.id}`, plugin: p.id, pluginName: p.name, ...c })));
    setAccounts(list);
    setSelected((current) => (list.some((a) => a.key === current) ? current : list[0]?.key || ''));
  }, [pluginId]);

  useEffect(() => {
    loadAccounts().catch((err) => setError(err.message));
  }, [loadAccounts]);

  const current = accounts?.find((a) => a.key === selected) || null;
  const base = current ? `/plugins/${current.plugin}/connections/${current.id}` : null;

  const loadConversations = useCallback(async () => {
    if (!base) return;
    setError('');
    try {
      const data = await api(`${base}/conversations`);
      setConversations(data.conversations);
    } catch (err) {
      setError(err.message);
    }
  }, [base]);

  useEffect(() => {
    setActive(null);
    setMessages([]);
    loadConversations();
  }, [loadConversations]);

  async function openConversation(conv) {
    setActive(conv);
    setMessages([]);
    setError('');
    try {
      const data = await api(`${base}/conversations/${conv.id}/messages`);
      setMessages(data.messages);
    } catch (err) {
      setError(err.message);
    }
  }

  async function send(e) {
    e.preventDefault();
    const text = reply.trim();
    if (!text || !active?.customer) return;
    setSending(true);
    setError('');
    try {
      await api(`${base}/reply`, { method: 'POST', body: { recipient_id: active.customer.id, text } });
      setReply('');
      await openConversation(active);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (accounts === null) return <div className="inbox-status muted">{error || 'Loading…'}</div>;

  if (accounts.length === 0) {
    return (
      <div className="inbox">
        <div className="inbox-card">
          <h2>No accounts connected</h2>
          <p className="muted">Connect an account on the Setup tab. Its conversations will show up here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="inbox">
      {error && <div className="error">{error}</div>}

      <div className="inbox-head">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Account">
          {accounts.map((a) => (
            <option key={a.key} value={a.key}>
              {a.name} ({a.pluginName})
            </option>
          ))}
        </select>
        <button className="btn small ghost" onClick={loadConversations}>
          Refresh
        </button>
      </div>

      <div className="inbox-body">
        <div className="inbox-list">
          {conversations.length === 0 && <p className="muted inbox-empty">No conversations yet.</p>}
          {conversations.map((conv) => (
            <button
              key={conv.id}
              className={`inbox-conv ${active?.id === conv.id ? 'active' : ''}`}
              onClick={() => openConversation(conv)}
            >
              <span className="inbox-conv-name">{conv.customer?.name || 'Customer'}</span>
              <span className="muted inbox-snippet">{conv.snippet}</span>
            </button>
          ))}
        </div>

        <div className="inbox-thread">
          {!active ? (
            <p className="muted inbox-empty">Choose a conversation to read it.</p>
          ) : (
            <>
              <div className="inbox-messages">
                {messages.map((m) => (
                  <div key={m.id} className={`inbox-msg ${m.from_page ? 'page' : 'customer'}`}>
                    {m.text || <em>(attachment)</em>}
                  </div>
                ))}
              </div>
              <form className="inbox-reply" onSubmit={send}>
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={`Reply to ${active.customer?.name || 'customer'}`}
                  maxLength={2000}
                />
                <div className="inbox-reply-bar">
                  <span className="hint">Replies can only be sent within 24 hours of the customer's last message.</span>
                  <button className="btn primary" disabled={sending || !reply.trim()}>
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
