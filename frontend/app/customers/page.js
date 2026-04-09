'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import NotificationBell from '@/app/components/NotificationBell';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

// ─── Format helpers ─────────────────────────────────────────
function fmtCurrency(v) {
  if (v == null) return '—';
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M ₴';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K ₴';
  return v.toFixed(0) + ' ₴';
}
function fmtNum(v) { return v == null ? '—' : v.toLocaleString('uk-UA'); }
function fmtPct(v) { return v == null ? '—' : v.toFixed(1) + '%'; }

const COLORS = ['#2ECC71', '#3498DB', '#9B59B6', '#F39C12', '#E74C3C', '#1ABC9C'];

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '8px', padding: '8px 12px', fontSize: '0.8rem'
    }}>
      <div style={{ color: '#94A3B8', marginBottom: '4px' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontWeight: 600, fontSize: '0.82rem' }}>
          {p.name === 'returning' ? '🔄 Повторні' : '🆕 Нові'}: {p.value}
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────
export default function CustomersPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('90d');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const u = api.getUser();
    if (!u || !api.token) { router.push('/login'); return; }
    setUser(u);
    loadData();
  }, []);

  useEffect(() => { if (user) loadData(); }, [period]);

  async function loadData() {
    setLoading(true);
    const now = new Date();
    let date_from, date_to = now.toISOString().slice(0, 10);
    if (period === 'mtd') date_from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    else if (period === '30d') date_from = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
    else if (period === '90d') date_from = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
    else date_from = new Date(now - 7 * 86400000).toISOString().slice(0, 10);

    try {
      const res = await api.getCustomerAnalytics({ date_from, date_to });
      setData(res);
    } catch (e) {
      console.error('Load error:', e);
    }
    setLoading(false);
  }

  function navigate(path) { setSidebarOpen(false); router.push(path); }
  function handleLogout() { api.logout(); router.push('/login'); }

  if (!user) return null;
  const k = data?.kpis || {};

  return (
    <div className="app-layout">
      {/* Mobile Header */}
      <header className="mobile-header">
        <button className={`burger-btn${sidebarOpen ? ' open' : ''}`}
          onClick={() => setSidebarOpen(o => !o)} aria-label="Меню">
          <span className="burger-line" /><span className="burger-line" /><span className="burger-line" />
        </button>
        <span className="mobile-header-logo">🐾 Practik UA</span>
      </header>

      <div className={`sidebar-overlay${sidebarOpen ? ' visible' : ''}`} onClick={() => setSidebarOpen(false)} />

      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <div>
            <h1>🐾 Practik UA</h1>
            <span>Mission Control</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-item" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>📊 Аналітика товарів</div>
          <div className="nav-item active" onClick={() => navigate('/customers')}>👤 Клієнти</div>
          <div className="nav-item" onClick={() => navigate('/marketing')} style={{ cursor: 'pointer' }}>📈 Маркетинг</div>
          <div className="nav-item" onClick={() => navigate('/warehouse')} style={{ cursor: 'pointer' }}>🏭 Склад</div>
          <div className="nav-item" onClick={() => navigate('/finance')} style={{ cursor: 'pointer' }}>💰 Фінанси</div>
          <div className="nav-item" onClick={() => navigate('/hr')} style={{ cursor: 'pointer' }}>👥 HR</div>
          <div className="nav-item" onClick={() => navigate('/complaints')} style={{ cursor: 'pointer' }}>📋 Скарги</div>
          {user.role === 'developer' && (
            <div className="nav-item" onClick={() => navigate('/admin')} style={{ cursor: 'pointer' }}>⚙️ Адмін-панель</div>
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
          <button className="btn btn-secondary btn-sm" onClick={handleLogout}>Вийти</button>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        <div className="page-header">
          <div>
            <h2>👤 Клієнтська аналітика</h2>
            <p>Лояльність, утримання та якість клієнтської бази</p>
          </div>
          <div className="header-actions">
            <NotificationBell />
          </div>
        </div>

        {/* Filters */}
        <div className="filters-bar">
          {['7d', '30d', 'mtd', '90d'].map(p => (
            <button key={p} className={`filter-chip ${period === p ? 'active' : ''}`}
                    onClick={() => setPeriod(p)}>
              {p === 'mtd' ? 'MTD' : p === '7d' ? '7 днів' : p === '30d' ? '30 днів' : '90 днів'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="loading-spinner"><div className="spinner" /></div>
        ) : (
          <>
            {/* KPI Grid */}
            <div className="customer-kpi-grid">
              <div className="kpi-card">
                <div className="kpi-icon">👥</div>
                <div className="kpi-label">Всього клієнтів</div>
                <div className="kpi-value">{k.total_customers || 0}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-icon">🆕</div>
                <div className="kpi-label">Нові клієнти</div>
                <div className="kpi-value" style={{ color: 'var(--accent-blue)' }}>{k.new_customers || 0}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-icon">🔄</div>
                <div className="kpi-label">Повторні</div>
                <div className="kpi-value" style={{ color: 'var(--accent-green)' }}>{k.returning_customers || 0}</div>
                <span className="kpi-delta positive">{k.returning_pct || 0}%</span>
              </div>
              <div className="kpi-card">
                <div className="kpi-icon">🧾</div>
                <div className="kpi-label">Середній чек</div>
                <div className="kpi-value">{fmtCurrency(k.avg_check)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-icon">💎</div>
                <div className="kpi-label">LTV</div>
                <div className="kpi-value">{fmtCurrency(k.avg_ltv)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-icon">📌</div>
                <div className="kpi-label">Retention</div>
                <div className="kpi-value" style={{ color: k.retention_rate >= 60 ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                  {fmtPct(k.retention_rate)}
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-icon">📤</div>
                <div className="kpi-label">Churn</div>
                <div className="kpi-value" style={{ color: k.churn_rate > 30 ? 'var(--accent-red)' : 'var(--text-primary)' }}>
                  {fmtPct(k.churn_rate)}
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-icon">📅</div>
                <div className="kpi-label">Інтервал замовлення</div>
                <div className="kpi-value">{k.avg_interval_days || 0} <span style={{ fontSize: '0.9rem', fontWeight: 400 }}>днів</span></div>
              </div>
            </div>

            {/* Charts Row */}
            <div className="customer-charts-grid">
              {/* Stacked bar: new vs returning by week */}
              <div className="card customer-chart-card">
                <div className="card-title">📊 Нові vs повторні клієнти по тижнях</div>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data?.weekly_trend || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="week" tick={{ fill: '#64748B', fontSize: 10 }} tickFormatter={d => d?.slice(5)} />
                    <YAxis tick={{ fill: '#64748B', fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="returning" name="returning" stackId="a" fill="#2ECC71" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="new" name="new" stackId="a" fill="#3498DB" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Channel distribution */}
              <div className="card customer-chart-card">
                <div className="card-title">📡 Розподіл по каналах</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={(data?.channel_distribution || []).map((c, i) => ({ ...c, name: c.channel, value: c.customers }))}
                      cx="50%" cy="50%"
                      innerRadius={50} outerRadius={80}
                      dataKey="value"
                      stroke="none"
                    >
                      {(data?.channel_distribution || []).map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, name) => [v + ' клієнтів', name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="channel-legend">
                  {(data?.channel_distribution || []).map((c, i) => (
                    <div key={i} className="channel-legend-item">
                      <div className="channel-legend-dot" style={{ background: COLORS[i % COLORS.length] }} />
                      <span style={{ color: 'var(--text-secondary)' }}>{c.channel}</span>
                      <span className="channel-legend-value">{c.customers} кл. · {fmtCurrency(c.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Top Customers Table */}
            <div className="card data-table-wrapper">
              <div className="card-title">🏆 Топ клієнти по LTV</div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Клієнт</th>
                      <th>Канал</th>
                      <th>Замовлень</th>
                      <th>Виторг (LTV)</th>
                      <th>Сер. чек</th>
                      <th>Перше замовлення</th>
                      <th>Останнє замовлення</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.top_customers || []).map((c, i) => (
                      <tr key={c.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                              width: '28px', height: '28px', borderRadius: '50%',
                              background: `linear-gradient(135deg, ${COLORS[i % COLORS.length]}, ${COLORS[(i + 1) % COLORS.length]})`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '0.7rem', fontWeight: 700, flexShrink: 0,
                            }}>{i + 1}</div>
                            <div>
                              <strong>{c.name}</strong>
                              <br /><span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{c.region}</span>
                            </div>
                          </div>
                        </td>
                        <td><span className="status-badge normal" style={{ background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' }}>{c.channel}</span></td>
                        <td style={{ fontWeight: 600 }}>{c.orders}</td>
                        <td style={{ fontWeight: 700, color: 'var(--accent-green)' }}>{fmtCurrency(c.ltv)}</td>
                        <td>{fmtCurrency(c.avg_check)}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{c.first_order}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{c.last_order}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
