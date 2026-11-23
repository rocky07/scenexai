import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import ProviderSwitch from './ProviderSwitch.jsx';

const PROVIDER_KEY = 'scenex.provider';
// How often to check whether a reply is ready. Each check is a short request, so the gateway never times out.
const POLL_MS = 2500;

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
  const [sending, setSending] = useState(false); // the message is being saved
  const [waitingFor, setWaitingFor] = useState(null); // { chatId, messageId } while a reply is being written
  const [error, setError] = useState('');
  const loadedChatId = useRef(null);
  const endRef = useRef(null);

  const busy = sending || Boolean(waitingFor);

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

  // Load history when opening an existing chat. If a reply was still being written, keep waiting for it.
  useEffect(() => {
    if (!chatId) {
      loadedChatId.current = null;
      setMessages([]);
      setWaitingFor(null);
      setError('');
      return;
    }
    // Skip the reload right after we created the chat ourselves.
    if (loadedChatId.current === chatId) return;

    setError('');
    setWaitingFor(null);
    api(`/chats/${chatId}`).then(({ messages }) => {
      loadedChatId.current = chatId;
      setMessages(messages);
      const pending = messages.find((m) => m.status === 'pending');
      if (pending) setWaitingFor({ chatId, messageId: pending.id });
    });
  }, [chatId]);

  // While a reply is being written, check the chat until it's ready.
  useEffect(() => {
    if (!waitingFor) return undefined;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const { messages: latest } = await api(`/chats/${waitingFor.chatId}`);
        if (stopped) return;
        const reply = latest.find((m) => m.id === waitingFor.messageId);
        if (reply && reply.status !== 'pending') {
          setMessages(latest);
          setWaitingFor(null);
        }
      } catch (err) {
        if (!stopped) setError(err.message);
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [waitingFor]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  async function send(e) {
    e?.preventDefault();
    const content = input.trim();
    if (!content || busy) return;

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

      // The server saves the message and answers at once with a pending reply. The reply is filled in by polling.
      const data = await api(`/chats/${id}/messages`, { method: 'POST', body: { content, provider } });
      setMessages((list) => [...list.filter((m) => m.id !== pendingId), data.userMessage, data.assistantMessage]);
      onChatSaved(data.chat);
      setWaitingFor({ chatId: id, messageId: data.assistantMessage.id });
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
        <ProviderSwitch providers={providers} value={provider} onChange={setProvider} disabled={busy} />
        <button className="send-btn" disabled={busy || !input.trim()} aria-label="Send message">
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
            {m.status === 'pending' ? (
              <div className="bubble typing">
                <span />
                <span />
                <span />
              </div>
            ) : m.status === 'error' ? (
              <div className="bubble error">Couldn’t write this reply. {m.error}</div>
            ) : (
              <div className="bubble">{m.content}</div>
            )}
            {m.role === 'assistant' && m.provider && m.status !== 'pending' && (
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
