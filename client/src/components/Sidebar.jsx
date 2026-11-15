export default function Sidebar({
  chats,
  activeChatId,
  activeView,
  companyName,
  userName,
  onNewChat,
  onOpenChat,
  onDeleteChat,
  onProfile,
  onLogout,
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <span className="brand-mark">S</span>
          <span>Scenex AI</span>
        </div>
        <button className="btn new-chat" onClick={onNewChat}>
          <span aria-hidden="true">+</span> New chat
        </button>
      </div>

      <nav className="chat-list" aria-label="Chats">
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
              ×
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
