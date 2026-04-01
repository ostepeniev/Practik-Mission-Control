'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

// ─── Helpers ────────────────────────────────────────────────
const severityLabels = { low: 'Низька', medium: 'Середня', high: 'Висока' };
const severityColors = { low: '#64748B', medium: '#F59E0B', high: '#EF4444' };
const statusLabels = { new: 'Нова', investigating: 'Розслідування', resolved: 'Вирішена', dismissed: 'Відхилена' };
const statusIcons = { new: '🆕', investigating: '🔍', resolved: '✅', dismissed: '❌' };

function SeverityBadge({ severity }) {
  return (
    <span className={`complaint-severity-badge severity-${severity}`}>
      {severityLabels[severity] || severity}
    </span>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`complaint-status-badge status-${status}`}>
      {statusIcons[status]} {statusLabels[status] || status}
    </span>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '8px', padding: '8px 12px', fontSize: '0.8rem'
    }}>
      <div style={{ color: '#94A3B8', marginBottom: '2px' }}>{label}</div>
      <div style={{ color: '#F1F5F9', fontWeight: 700 }}>{payload[0].value} скарг</div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────
export default function ComplaintsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [complaints, setComplaints] = useState([]);
  const [summary, setSummary] = useState(null);
  const [period, setPeriod] = useState('90d');
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingComplaint, setEditingComplaint] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({
    product_id: '', complaint_date: new Date().toISOString().slice(0, 10),
    batch_number: '', source: 'клієнт', description: '', severity: 'medium'
  });

  useEffect(() => {
    const u = api.getUser();
    if (!u || !api.token) { router.push('/login'); return; }
    setUser(u);
    loadProducts();
    loadData();
  }, []);

  useEffect(() => { if (user) loadData(); }, [period, statusFilter, severityFilter]);

  async function loadProducts() {
    try {
      const res = await api.getProducts({ sort_by: 'name', sort_dir: 'asc' });
      setProducts(res?.products || []);
    } catch (e) { console.error(e); }
  }

  function getDateRange() {
    const now = new Date();
    let date_from;
    const date_to = now.toISOString().slice(0, 10);
    if (period === '30d') date_from = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
    else if (period === '60d') date_from = new Date(now - 60 * 86400000).toISOString().slice(0, 10);
    else date_from = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
    return { date_from, date_to };
  }

  async function loadData() {
    setLoading(true);
    const { date_from, date_to } = getDateRange();
    const params = { date_from, date_to };
    if (statusFilter) params.status = statusFilter;
    if (severityFilter) params.severity = severityFilter;

    try {
      const [comp, summ] = await Promise.all([
        api.getComplaints(params),
        api.getComplaintsSummary({ date_from, date_to }),
      ]);
      setComplaints(comp?.complaints || []);
      setSummary(summ);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await api.createComplaint(form);
      setShowModal(false);
      setForm({
        product_id: '', complaint_date: new Date().toISOString().slice(0, 10),
        batch_number: '', source: 'клієнт', description: '', severity: 'medium'
      });
      loadData();
    } catch (e) { console.error(e); }
  }

  async function handleStatusChange(id, newStatus) {
    try {
      await api.updateComplaint(id, { status: newStatus });
      loadData();
    } catch (e) { console.error(e); }
  }

  async function handleDelete(id) {
    if (!confirm('Видалити скаргу?')) return;
    try {
      await api.deleteComplaint(id);
      loadData();
    } catch (e) { console.error(e); }
  }

  if (!user) return null;

  const kpi = summary?.kpi || { total: 0, delta_pct: 0 };
  const clusters = summary?.clusters || [];
  const timeline = summary?.timeline || [];
  const topProducts = summary?.top_products || [];
  const byStatus = summary?.by_status || [];
  const bySeverity = summary?.by_severity || [];

  const newCount = byStatus.find(s => s.status === 'new')?.cnt || 0;
  const investigatingCount = byStatus.find(s => s.status === 'investigating')?.cnt || 0;
  const highCount = bySeverity.find(s => s.severity === 'high')?.cnt || 0;

  function navigate(path) {
    setSidebarOpen(false);
    router.push(path);
  }

  return (
    <div className="app-layout">
      {/* Mobile Header */}
      <header className="mobile-header">
        <button
          className={`burger-btn${sidebarOpen ? ' open' : ''}`}
          onClick={() => setSidebarOpen(o => !o)}
          aria-label="Меню"
        >
          <span className="burger-line" />
          <span className="burger-line" />
          <span className="burger-line" />
        </button>
        <span className="mobile-header-logo">🐾 Practik UA</span>
        {user.role === 'developer' && <span className="dev-badge">🛠 Dev</span>}
      </header>

      {/* Overlay */}
      <div
        className={`sidebar-overlay${sidebarOpen ? ' visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <div>
            <h1>🐾 Practik UA</h1>
            <span>Analytics Dashboard</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-item" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>📊 Аналітика товарів</div>
          <div className="nav-item" onClick={() => navigate('/marketing')} style={{ cursor: 'pointer' }}>📈 Маркетинг</div>
          <div className="nav-item" style={{ opacity: 0.5 }}>🏭 Склад</div>
          <div className="nav-item" style={{ opacity: 0.5 }}>💰 Фінанси</div>
          <div className="nav-item" style={{ opacity: 0.5 }}>👥 HR</div>
          <div className="nav-item active">📋 Скарги</div>
          {user.role === 'developer' && (
            <div className="nav-item" onClick={() => navigate('/admin')} style={{ cursor: 'pointer' }}>
              ⚙️ Адмін-панель
            </div>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{user.display_name?.[0]}</div>
            <div>
              <div className="user-name">{user.display_name}</div>
              <div className="user-role">{user.role === 'developer' ? '🛠 Розробник' : '👤 Власник'}</div>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => { api.logout(); router.push('/login'); }}>Вийти</button>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        <div className="page-header">
          <div>
            <h2>📋 Скарги та контроль якості</h2>
            <p>Моніторинг скарг, виявлення проблемних партій</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            + Нова скарга
          </button>
        </div>

        {/* Filters */}
        <div className="filters-bar">
          {['30d', '60d', '90d'].map(p => (
            <button key={p} className={`filter-chip ${period === p ? 'active' : ''}`}
                    onClick={() => setPeriod(p)}>
              {p === '30d' ? '30 днів' : p === '60d' ? '60 днів' : '90 днів'}
            </button>
          ))}
          <select className="filter-select" value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Всі статуси</option>
            <option value="new">🆕 Нові</option>
            <option value="investigating">🔍 Розслідування</option>
            <option value="resolved">✅ Вирішені</option>
            <option value="dismissed">❌ Відхилені</option>
          </select>
          <select className="filter-select" value={severityFilter}
                  onChange={e => setSeverityFilter(e.target.value)}>
            <option value="">Всі рівні</option>
            <option value="high">🔴 Високий</option>
            <option value="medium">🟡 Середній</option>
            <option value="low">⚪ Низький</option>
          </select>
        </div>

        {loading ? (
          <div className="loading-spinner"><div className="spinner" /></div>
        ) : (
          <>
            {/* KPI Row */}
            <div className="kpi-grid complaints-kpi">
              <div className="kpi-card">
                <div className="kpi-icon">📋</div>
                <div className="kpi-label">Скарг за період</div>
                <div className="kpi-value">{kpi.total}</div>
                <span className={`kpi-delta ${kpi.delta_pct > 0 ? 'negative' : kpi.delta_pct < 0 ? 'positive' : 'neutral'}`}>
                  {kpi.delta_pct > 0 ? '▲' : kpi.delta_pct < 0 ? '▼' : '—'} {kpi.delta_pct > 0 ? '+' : ''}{kpi.delta_pct}%
                </span>
              </div>
              <div className="kpi-card">
                <div className="kpi-icon">🆕</div>
                <div className="kpi-label">Нових</div>
                <div className="kpi-value">{newCount}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-icon">🔍</div>
                <div className="kpi-label">На розслідуванні</div>
                <div className="kpi-value">{investigatingCount}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-icon">🔴</div>
                <div className="kpi-label">Високий рівень</div>
                <div className="kpi-value">{highCount}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-icon">⚠️</div>
                <div className="kpi-label">Проблемних партій</div>
                <div className="kpi-value">{clusters.length}</div>
              </div>
            </div>

            {/* Clusters Alert */}
            {clusters.length > 0 && (
              <div className="card batch-alerts-card">
                <div className="card-title">⚠️ Підозра на проблемні партії</div>
                <div className="batch-alerts-list">
                  {clusters.map((cl, i) => (
                    <div key={i} className={`batch-alert-item batch-${cl.severity}`}>
                      <div className="batch-alert-header">
                        <span className={`batch-severity-tag ${cl.severity}`}>
                          {cl.severity === 'critical' ? '🔴 Критично' : '🟡 Увага'}
                        </span>
                        <strong>{cl.product_name}</strong>
                        <span className="batch-sku">{cl.product_sku}</span>
                      </div>
                      <div className="batch-alert-body">
                        <span>📊 <strong>{cl.complaint_count}</strong> скарг за {cl.date_from} — {cl.date_to}</span>
                        {cl.batches.length > 0 && (
                          <span className="batch-number-tag">📦 Партія: {cl.batches.join(', ')}</span>
                        )}
                        {cl.high_severity_count > 0 && (
                          <span>🔴 {cl.high_severity_count} високого рівня</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Charts Row */}
            <div className="charts-grid">
              {/* Timeline */}
              <div className="card chart-card">
                <div className="card-title">📈 Скарги по днях</div>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={timeline}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 11 }}
                           tickFormatter={d => d?.slice(5)} />
                    <YAxis tick={{ fill: '#64748B', fontSize: 11 }} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {timeline.map((entry, idx) => (
                        <Cell key={idx} fill={entry.count >= 3 ? '#EF4444' : entry.count >= 2 ? '#F59E0B' : '#3B82F6'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Top products */}
              <div className="card chart-card">
                <div className="card-title">🏆 Продукти з найбільше скарг</div>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={topProducts} layout="vertical" margin={{ left: 120 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="product_name" tick={{ fill: '#94A3B8', fontSize: 11 }} width={120}
                           tickFormatter={n => n?.length > 20 ? n.slice(0, 20) + '…' : n} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="complaint_count" fill="#EF4444" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Complaints Table */}
            <div className="card data-table-wrapper">
              <div className="card-title">📋 Всі скарги ({complaints.length})</div>
              <div className="table-scroll">
                <table className="data-table complaints-table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Товар</th>
                      <th>Партія</th>
                      <th>Джерело</th>
                      <th>Опис</th>
                      <th>Рівень</th>
                      <th>Статус</th>
                      <th>Дії</th>
                    </tr>
                  </thead>
                  <tbody>
                    {complaints.map(c => (
                      <tr key={c.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{c.complaint_date}</td>
                        <td>
                          <strong>{c.product_name}</strong>
                          <br /><span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{c.product_sku}</span>
                        </td>
                        <td>
                          {c.batch_number ? (
                            <span className="batch-number-tag">📦 {c.batch_number}</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                          )}
                        </td>
                        <td style={{ textTransform: 'capitalize' }}>{c.source}</td>
                        <td style={{ maxWidth: '300px' }}>{c.description}</td>
                        <td><SeverityBadge severity={c.severity} /></td>
                        <td>
                          <select
                            className="status-select"
                            value={c.status}
                            onChange={e => handleStatusChange(c.id, e.target.value)}
                          >
                            <option value="new">🆕 Нова</option>
                            <option value="investigating">🔍 Розслідування</option>
                            <option value="resolved">✅ Вирішена</option>
                            <option value="dismissed">❌ Відхилена</option>
                          </select>
                        </td>
                        <td>
                          <button className="btn btn-secondary btn-xs" onClick={() => handleDelete(c.id)}
                                  title="Видалити">🗑</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Create Complaint Modal */}
        {showModal && (
          <div className="modal-overlay" onClick={() => setShowModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Нова скарга</h3>
                <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
              </div>
              <form onSubmit={handleCreate} className="complaint-form">
                <div className="form-group">
                  <label>Товар *</label>
                  <select required value={form.product_id}
                          onChange={e => setForm({ ...form, product_id: e.target.value })}>
                    <option value="">— Оберіть товар —</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Дата скарги *</label>
                    <input type="date" required value={form.complaint_date}
                           onChange={e => setForm({ ...form, complaint_date: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Номер партії</label>
                    <input type="text" placeholder="P2026-XXXX" value={form.batch_number}
                           onChange={e => setForm({ ...form, batch_number: e.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Джерело</label>
                    <select value={form.source}
                            onChange={e => setForm({ ...form, source: e.target.value })}>
                      <option value="клієнт">Клієнт</option>
                      <option value="маркетплейс">Маркетплейс</option>
                      <option value="дистриб'ютор">Дистриб'ютор</option>
                      <option value="соцмережі">Соцмережі</option>
                      <option value="гаряча лінія">Гаряча лінія</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Рівень</label>
                    <select value={form.severity}
                            onChange={e => setForm({ ...form, severity: e.target.value })}>
                      <option value="low">Низький</option>
                      <option value="medium">Середній</option>
                      <option value="high">Високий</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>Опис скарги *</label>
                  <textarea required rows={3} placeholder="Опишіть суть скарги..."
                            value={form.description}
                            onChange={e => setForm({ ...form, description: e.target.value })} />
                </div>
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Скасувати</button>
                  <button type="submit" className="btn btn-primary">Створити скаргу</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
