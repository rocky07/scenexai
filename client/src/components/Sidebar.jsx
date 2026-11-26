import Icon from './Icon.jsx';
import logo from '../../logo.png';

// Claude-style sidebar: primary navigation at the top, recent chats in the middle, account at the bottom.
const NAV = [
  { id: 'chat', label: 'New chat', icon: 'plus' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'scheduled', label: 'Scheduled', icon: 'clock' },
  { id: 'drafts', label: 'Drafts', icon: 'file' },
  { id: 'plugins', label: 'Plugins', icon: 'plug' },
];

export default function Sidebar({
  chats,
  briefings = [],
  activeChatId,
  activeBriefingId,
  activeView,
  companyName,
  userName,
  onNav,
  onOpenChat,
  onOpenBriefing,
  onDeleteChat,
  onProfile,
  onLogout,
}) {
  // Chats and briefings share the Recents list, newest first.
  const recents = [
    ...chats.map((c) => ({ kind: 'chat', id: c.id, title: c.title, when: c.updated_at })),
    ...briefings.map((b) => ({ kind: 'briefing', id: b.id, title: b.title, when: b.created_at })),
  ].sort((a, b) => b.when.localeCompare(a.when));
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <img className="brand-logo" src={logo} alt="" />
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
        {recents.length > 0 && <div className="section-label">Recents</div>}
        {recents.map((item) =>
          item.kind === 'chat' ? (
            <div key={`chat-${item.id}`} className={`chat-item ${item.id === activeChatId ? 'active' : ''}`}>
              <button className="chat-link recent-link" onClick={() => onOpenChat(item.id)} title={item.title}>
                <Icon name="chat" size={16} />
                <span>{item.title}</span>
              </button>
              <button
                className="icon-btn small"
                aria-label={`Delete ${item.title}`}
                onClick={() => {
                  if (window.confirm('Delete this chat?')) onDeleteChat(item.id);
                }}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ) : (
            <div
              key={`briefing-${item.id}`}
              className={`chat-item ${item.id === activeBriefingId ? 'active' : ''}`}
            >
              <button className="chat-link recent-link" onClick={() => onOpenBriefing(item.id)} title={item.title}>
                <Icon name="clock" size={16} />
                <span>{item.title}</span>
              </button>
            </div>
          ),
        )}
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
