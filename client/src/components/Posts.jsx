import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDate } from './Search.jsx';

// Recent posts for a connected account, ordered by engagement, with the top comments on each.
export default function Posts({ plugin }) {
  const accounts = plugin.connections;
  const [connectionId, setConnectionId] = useState(accounts[0]?.id || '');
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState('');
  const [reconnect, setReconnect] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load(id) {
    if (!id) return;
    setLoading(true);
    setError('');
    setReconnect(false);
    try {
      const data = await api(`/plugins/${plugin.id}/connections/${id}/posts`);
      setPosts(data.posts);
    } catch (err) {
      setPosts([]);
      setError(err.message);
      setReconnect(Boolean(err.data?.needs_reconnect));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(connectionId);
  }, [connectionId]);

  if (accounts.length === 0) {
    return <p className="muted">Connect {plugin.name} on the Setup tab to see its posts.</p>;
  }

  return (
    <section className="posts">
      <div className="posts-head">
        {accounts.length > 1 ? (
          <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)} aria-label="Account">
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        ) : (
          <strong>{accounts[0].name}</strong>
        )}
        <button className="btn small ghost" onClick={() => load(connectionId)} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="error">
          {error}
          {reconnect && <div className="hint">Use the Setup tab to connect {plugin.name} again.</div>}
        </div>
      )}

      {posts && posts.length === 0 && !error && <p className="muted">No posts found.</p>}

      <ul className="draft-list">
        {(posts || []).map((post) => (
          <li key={post.id} className="draft-card">
            <p className="draft-text">{post.text || <em className="muted">(no text)</em>}</p>
            <div className="post-stats">
              <span>{post.reactions} reactions</span>
              <span>{post.comments} comments</span>
              {post.shares > 0 && <span>{post.shares} shares</span>}
              {post.created_time && <span className="muted">{formatDate(post.created_time)}</span>}
            </div>

            {post.top_comments.length > 0 && (
              <div className="post-comments">
                <span className="section-label-lg">Top comments</span>
                {post.top_comments.map((c) => (
                  <div key={c.id} className="post-comment">
                    <strong>{c.from}</strong> <span>{c.text}</span>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
