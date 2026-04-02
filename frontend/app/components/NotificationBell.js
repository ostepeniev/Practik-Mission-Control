'use client';
import { useEffect, useState, useRef } from 'react';
import api from '@/lib/api';

const SEVERITY_ICONS = {
  critical: '🔴',
  risk: '🟠',
  warning: '🟡',
  info: '🔵',
  success: '🟢',
};

const TYPE_ICONS = {
  alert: '⚠️',
  complaint: '📢',
  ai_insight: '🤖',
  system: '⚙️',
  heartbeat: '💓',
};

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function loadNotifications() {
    try {
      const data = await api.getNotifications(20);
      setNotifications(data.notifications || []);
      setUnreadCount(data.unread_count || 0);
    } catch (e) { /* silent */ }
  }

  async function handleMarkAllRead() {
    setLoading(true);
    try {
      await api.markAllNotificationsRead();
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
    } catch (e) { /* silent */ }
    setLoading(false);
  }

  async function handleMarkRead(id) {
    try {
      await api.markNotificationsRead([id]);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (e) { /* silent */ }
  }

  function timeAgo(dateStr) {
    const diff = (Date.now() - new Date(dateStr + 'Z').getTime()) / 1000;
    if (diff < 60) return 'щойно';
    if (diff < 3600) return Math.floor(diff / 60) + ' хв';
    if (diff < 86400) return Math.floor(diff / 3600) + ' год';
    return Math.floor(diff / 86400) + ' дн';
  }

  return (
    <div className="notification-bell-wrapper" ref={ref}>
      <button
        className="notification-bell"
        onClick={() => setOpen(o => !o)}
        title="Сповіщення"
      >
        🔔
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="notification-dropdown">
          <div className="notification-header">
            <span className="notification-header-title">Сповіщення</span>
            {unreadCount > 0 && (
              <button
                className="notification-mark-all"
                onClick={handleMarkAllRead}
                disabled={loading}
              >
                Прочитати всі
              </button>
            )}
          </div>

          <div className="notification-list">
            {notifications.length === 0 ? (
              <div className="notification-empty">✅ Немає сповіщень</div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={`notification-item ${n.is_read ? 'read' : 'unread'}`}
                  onClick={() => {
                    if (!n.is_read) handleMarkRead(n.id);
                    if (n.link) window.location.href = n.link;
                  }}
                >
                  <div className="notification-icon">
                    {SEVERITY_ICONS[n.severity] || TYPE_ICONS[n.type] || '📋'}
                  </div>
                  <div className="notification-content">
                    <div className="notification-title">{n.title}</div>
                    {n.body && <div className="notification-body">{n.body}</div>}
                    <div className="notification-meta">
                      {TYPE_ICONS[n.type] || ''} {n.source} · {timeAgo(n.created_at)}
                    </div>
                  </div>
                  {!n.is_read && <div className="notification-dot" />}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
