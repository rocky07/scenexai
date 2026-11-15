import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Sidebar from './Sidebar.jsx';
import Chat from './Chat.jsx';
import Profile from './Profile.jsx';

// Layout: sidebar on the left, the active page on the right.
export default function Shell({ session, onCompanyChange, onLogout }) {
  // { name: 'chat', chatId? } | { name: 'profile' }. A chat without chatId is a blank "new chat"
  // that gets saved on the first message.
  const [view, setView] = useState({ name: 'chat' });
  const [chats, setChats] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const firstName = session.user.name.split(' ')[0];

  useEffect(() => {
    api('/chats').then((data) => setChats(data.chats));
  }, []);

  function upsertChat(chat) {
    setChats((list) => [chat, ...list.filter((c) => c.id !== chat.id)]);
  }

  function go(next) {
    setView(next);
    setSidebarOpen(false);
  }

  async function deleteChat(chatId) {
    await api(`/chats/${chatId}`, { method: 'DELETE' });
    setChats((list) => list.filter((c) => c.id !== chatId));
    if (view.chatId === chatId) setView({ name: 'chat' });
  }

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <Sidebar
        chats={chats}
        activeChatId={view.name === 'chat' ? view.chatId : null}
        activeView={view.name}
        companyName={session.company.name}
        userName={session.user.name}
        onNewChat={() => go({ name: 'chat' })}
        onOpenChat={(chatId) => go({ name: 'chat', chatId })}
        onDeleteChat={deleteChat}
        onProfile={() => go({ name: 'profile' })}
        onLogout={onLogout}
      />

      <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />

      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-toggle" aria-label="Open menu" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>
          <span className="topbar-title">{view.name === 'profile' ? 'Company profile' : 'Scenex AI'}</span>
        </header>

        {view.name === 'profile' ? (
          <Profile company={session.company} onSaved={onCompanyChange} />
        ) : (
          <Chat
            chatId={view.chatId}
            firstName={firstName}
            companyName={session.company.name}
            onChatSaved={(chat) => {
              upsertChat(chat);
              setView((v) => (v.chatId === chat.id ? v : { name: 'chat', chatId: chat.id }));
            }}
          />
        )}
      </main>
    </div>
  );
}
