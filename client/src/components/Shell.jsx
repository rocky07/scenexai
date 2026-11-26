import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Sidebar from './Sidebar.jsx';
import Chat from './Chat.jsx';
import Profile from './Profile.jsx';
import Search from './Search.jsx';
import Scheduled from './Scheduled.jsx';
import Plugins from './Plugins.jsx';
import Drafts from './Drafts.jsx';

const TITLES = { search: 'Search', scheduled: 'Scheduled', drafts: 'Drafts', plugins: 'Plugins', profile: 'Company profile' };

// Layout: sidebar on the left, the active screen on the right.
export default function Shell({ session, onCompanyChange, onLogout }) {
  // Each view is { name, ...details }. A chat without chatId is a blank "new chat" that is saved on the first message.
  // Returning from a plugin's login opens that plugin's page, where the result is shown.
  const [view, setView] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('plugin') ? { name: 'plugins', pluginId: params.get('plugin') } : { name: 'chat' };
  });
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

  function navigate(id) {
    go(id === 'chat' ? { name: 'chat' } : { name: id });
  }

  async function deleteChat(chatId) {
    await api(`/chats/${chatId}`, { method: 'DELETE' });
    setChats((list) => list.filter((c) => c.id !== chatId));
    if (view.chatId === chatId) setView({ name: 'chat' });
  }

  const sidebarActive = view.name === 'chat' ? 'chat' : view.name;

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <Sidebar
        chats={chats}
        activeChatId={view.name === 'chat' ? view.chatId : null}
        activeView={sidebarActive}
        companyName={session.company.name}
        userName={session.user.name}
        onNav={navigate}
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
          <span className="topbar-title">{TITLES[view.name] || 'Scenex AI'}</span>
        </header>

        {view.name === 'profile' && <Profile company={session.company} onSaved={onCompanyChange} />}

        {view.name === 'search' && (
          <Search
            onOpenChat={(id) => go({ name: 'chat', chatId: id })}
            onOpenBriefing={(id) => go({ name: 'scheduled', briefingId: id })}
            onOpenPlugin={(id) => go({ name: 'plugins', pluginId: id })}
            onOpenAccount={(pluginId) => go({ name: 'plugins', pluginId, tab: 'inbox' })}
          />
        )}

        {view.name === 'scheduled' && <Scheduled briefingId={view.briefingId} />}

        {view.name === 'drafts' && <Drafts />}

        {view.name === 'plugins' && <Plugins pluginId={view.pluginId} tab={view.tab} onNavigate={go} />}

        {view.name === 'chat' && (
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
