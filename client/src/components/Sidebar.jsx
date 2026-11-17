import Icon from './Icon.jsx';

// Claude-style sidebar: primary navigation at the top, recent chats in the middle, account at the bottom.
const NAV = [
  { id: 'chat', label: 'New chat', icon: 'plus' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'scheduled', label: 'Scheduled', icon: 'clock' },
  { id: 'plugins', label: 'Plugins', icon: 'plug' },
];

export default function Sidebar({
  chats,
  activeChatId,
  activeView,
  companyName,
  userName,
  onNav,
  onOpenChat,
  onDeleteChat,
  onProfile,
  onLogout,
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="" />
          <span>Scenex AI</span>
        </div>

        <nav className="nav" aria-label="Main">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeView === item.id ? 'active' : ''}`}
              onClick={() => onNav(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <nav className="chat-list" aria-label="Recents">
        {chats.length > 0 && <div className="section-label">Recents</div>}
        {chats.map((chat) => (
          <div key={chat.id} className={`chat-item ${chat.id === activeChatId ? 'active' : ''}`}>
            <button className="chat-link" onClick={() => onOpenChat(chat.id)} title={chat.title}>
              {chat.title}
            </button>
            <button
              className="icon-btn small"
              aria-label={`Delete ${chat.title}`}
              onClick={() => {
                if (window.confirm('Delete this chat?')) onDeleteChat(chat.id);
              }}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <button className={`account ${activeView === 'profile' ? 'active' : ''}`} onClick={onProfile}>
          <span className="avatar">{userName.charAt(0).toUpperCase()}</span>
          <span className="account-text">
            <span className="account-name">{userName}</span>
            <span className="account-company">{companyName}</span>
          </span>
        </button>
        <button className="btn ghost block small" onClick={onLogout}>
          Log out
        </button>
      </div>
    </aside>
  );
}
