import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import ProviderSwitch from './ProviderSwitch.jsx';

const PROVIDER_KEY = 'scenex.provider';

function greeting(firstName) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${firstName}`;
}

function savedProvider() {
  try {
    return localStorage.getItem(PROVIDER_KEY);
  } catch {
    return null;
  }
}

export default function Chat({ chatId, firstName, companyName, onChatSaved }) {
  const [messages, setMessages] = useState([]);
  const [providers, setProviders] = useState([]);
  const [provider, setProvider] = useState(savedProvider() || 'local');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const loadedChatId = useRef(null);
  const endRef = useRef(null);

  // Load the model list once and pick a usable provider if the saved one is offline.
  useEffect(() => {
    api('/providers').then(({ providers }) => {
      setProviders(providers);
      setProvider((current) => {
        const chosen = providers.find((p) => p.id === current);
        if (chosen?.available) return current;
        return providers.find((p) => p.available)?.id || current;
      });
    });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PROVIDER_KEY, provider);
    } catch {
      // Remembering the choice is a convenience only.
    }
  }, [provider]);

  // Load history when opening an existing chat. Skip the reload right after we created it.
  useEffect(() => {
    setError('');
    if (!chatId) {
      loadedChatId.current = null;
      setMessages([]);
      return;
    }
    if (loadedChatId.current === chatId) return;
    api(`/chats/${chatId}`).then(({ messages }) => {
      loadedChatId.current = chatId;
      setMessages(messages);
    });
  }, [chatId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  async function send(e) {
    e?.preventDefault();
    const content = input.trim();
    if (!content || sending) return;

    setInput('');
    setError('');
    setSending(true);
    const pendingId = `pending-${Date.now()}`;
    setMessages((list) => [...list, { id: pendingId, role: 'user', content }]);

    try {
      let id = chatId;
      if (!id) {
        // Register the chat before sending so a failed first message still shows in the sidebar.
        const { chat } = await api('/chats', { method: 'POST' });
        id = chat.id;
        loadedChatId.current = id;
        onChatSaved(chat);
      }

      const data = await api(`/chats/${id}/messages`, { method: 'POST', body: { content, provider } });
      setMessages((list) => [...list.filter((m) => m.id !== pendingId), data.userMessage, data.assistantMessage]);
      onChatSaved(data.chat);
    } catch (err) {
      // The server keeps the user's message on failure; show it and the reason.
      const saved = err.data?.userMessage;
      setMessages((list) => list.filter((m) => m.id !== pendingId).concat(saved ? [saved] : []));
      setError(err.message);
      setInput(saved ? '' : content);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) send(e);
  }

  const empty = messages.length === 0;
  const composer = (
    <form className="composer" onSubmit={send}>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={`Ask about ${companyName}'s posts, captions or ad copy…`}
        rows={2}
        aria-label="Message"
      />
      <div className="composer-bar">
        <ProviderSwitch providers={providers} value={provider} onChange={setProvider} disabled={sending} />
        <button className="send-btn" disabled={sending || !input.trim()} aria-label="Send message">
          ↑
        </button>
      </div>
    </form>
  );

  if (empty) {
    return (
      <div className="chat-empty">
        <h2 className="greeting">{greeting(firstName)}</h2>
        {composer}
        {error && <div className="error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="chat">
      <div className="thread">
        {messages.map((m) => (
          <div key={m.id} className={`message ${m.role}`}>
            <div className="bubble">{m.content}</div>
            {m.role === 'assistant' && m.provider && (
              <div className="meta">Written by {m.provider === 'claude' ? 'Claude' : 'local AI'}</div>
            )}
          </div>
        ))}
        {sending && (
          <div className="message assistant">
            <div className="bubble typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <div ref={endRef} />
      </div>
      {composer}
    </div>
  );
}
