'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import NotificationBell from '@/app/components/NotificationBell';

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [features, setFeatures] = useState([]);
  const [widgets, setWidgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('settings');

  // Audit state
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [auditFilters, setAuditFilters] = useState({ entity_types: [], actions: [] });
  const [auditEntityType, setAuditEntityType] = useState('');
  const [auditAction, setAuditAction] = useState('');

  useEffect(() => {
    const u = api.getUser();
    if (!u || !['developer', 'owner'].includes(u.role)) { router.push('/'); return; }
    setUser(u);
    load();
  }, []);

  useEffect(() => {
    if (tab === 'audit') loadAudit();
  }, [tab, auditPage, auditEntityType, auditAction]);

  async function load() {
    setLoading(true);
    const [f, w] = await Promise.all([api.getFeatures(), api.getWidgets()]);
    setFeatures(f?.features || []);
    setWidgets(w?.widgets || []);
    setLoading(false);
  }

  async function loadAudit() {
    try {
      const params = { page: auditPage };
      if (auditEntityType) params.entity_type = auditEntityType;
      if (auditAction) params.action = auditAction;
      const data = await api.getAuditLog(params);
      setAuditLogs(data.logs || []);
      setAuditTotal(data.total || 0);
      setAuditTotalPages(data.total_pages || 1);
      setAuditFilters(data.filters || { entity_types: [], actions: [] });
    } catch (e) { console.error(e); }
  }

  async function toggleFeature(key, current) {
    await api.toggleFeature(key, !current);
    setFeatures(prev => prev.map(f => f.key === key ? { ...f, is_enabled: !current } : f));
  }

  async function toggleWidget(id, current) {
    await api.toggleWidget(id, !current);
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, is_visible_owner: !current } : w));
  }

  if (!user) return null;

  const tabs = [
    { id: 'settings', label: '⚙️ Налаштування' },
    { id: 'audit', label: '📋 Журнал дій' },
  ];

  return (
    <div className="app-layout">
      <main className="main-content" style={{ marginLeft: 0 }}>
        <a className="back-link" onClick={() => router.push('/')} style={{ cursor: 'pointer' }}>
          ← Назад до дашборду
        </a>

        <div className="page-header">
          <div>
            <h2>⚙️ Адмін-панель</h2>
            <p>Керування системою та журнал дій</p>
          </div>
          <div className="header-actions">
            <NotificationBell />
            <span className="dev-badge">🛠 {user.role === 'developer' ? 'Dev' : 'Owner'}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="filters-bar" style={{ marginBottom: '16px' }}>
          {tabs.map(t => (
            <button key={t.id} className={`filter-chip ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Settings Tab */}
        {tab === 'settings' && (
          loading ? (
            <div className="loading-spinner"><div className="spinner" /></div>
          ) : (
            <div className="admin-grid">
              <div className="card">
                <div className="card-title">🚩 Feature Flags</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                  {features.map(f => (
                    <div key={f.key} className="admin-item">
                      <div>
                        <div className="admin-item-label">{f.key}</div>
                        <div className="admin-item-desc">{f.description}</div>
                      </div>
                      <button
                        className={`toggle ${f.is_enabled ? 'active' : ''}`}
                        onClick={() => toggleFeature(f.key, f.is_enabled)}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="card-title">👁 Видимість віджетів для Власника</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                  {widgets.map(w => (
                    <div key={w.id} className="admin-item">
                      <div>
                        <div className="admin-item-label">{w.title}</div>
                        <div className="admin-item-desc">{w.widget_type} · {w.size}</div>
                      </div>
                      <button
                        className={`toggle ${w.is_visible_owner ? 'active' : ''}`}
                        onClick={() => toggleWidget(w.id, w.is_visible_owner)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        )}

        {/* Audit Log Tab */}
        {tab === 'audit' && (
          <div className="card data-table-wrapper">
            <div className="card-title">📋 Журнал дій ({auditTotal})</div>

            {/* Filters */}
            <div className="audit-filters">
              <select className="filter-select" value={auditEntityType}
                onChange={e => { setAuditEntityType(e.target.value); setAuditPage(1); }}>
                <option value="">Всі сутності</option>
                {auditFilters.entity_types.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select className="filter-select" value={auditAction}
                onChange={e => { setAuditAction(e.target.value); setAuditPage(1); }}>
                <option value="">Всі дії</option>
                {auditFilters.actions.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Час</th><th>Користувач</th><th>Дія</th><th>Сутність</th><th>ID</th><th>Деталі</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                      Немає записів
                    </td></tr>
                  ) : (
                    auditLogs.map(log => (
                      <tr key={log.id}>
                        <td style={{ fontSize: '0.75rem' }}>{log.created_at?.replace('T', ' ').slice(0, 19)}</td>
                        <td>{log.user_name || '—'}</td>
                        <td><span className="status-badge normal">{log.action}</span></td>
                        <td>{log.entity_type || '—'}</td>
                        <td>{log.entity_id || '—'}</td>
                        <td className="audit-detail" title={log.details}>{log.details || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {auditTotalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '16px' }}>
                <button className="filter-chip" disabled={auditPage <= 1}
                  onClick={() => setAuditPage(p => p - 1)}>◀</button>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  {auditPage} / {auditTotalPages}
                </span>
                <button className="filter-chip" disabled={auditPage >= auditTotalPages}
                  onClick={() => setAuditPage(p => p + 1)}>▶</button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
