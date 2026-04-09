'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import NotificationBell from '@/app/components/NotificationBell';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

function fmtNum(v) { return v == null ? '—' : v.toLocaleString('uk-UA'); }
function fmtKg(v) { return v == null ? '—' : v >= 1000 ? (v/1000).toFixed(1)+'т' : v+'кг'; }
function fmtCurrency(v) {
  if (v == null) return '—';
  if (v >= 1e6) return (v/1e6).toFixed(1)+'M ₴';
  if (v >= 1000) return (v/1000).toFixed(1)+'K ₴';
  return Math.round(v)+' ₴';
}
function DeltaBadge({ value, inverse }) {
  if (value == null || value === 0) return <span className="kpi-delta neutral">— 0%</span>;
  const pos = inverse ? value < 0 : value > 0;
  return <span className={`kpi-delta ${pos ? 'positive' : 'negative'}`}>{pos ? '▲' : '▼'} {value > 0 ? '+' : ''}{value.toFixed(1)}%</span>;
}
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 14px', fontSize: '0.8rem' }}>
      <div style={{ color: '#94A3B8', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || '#F1F5F9', fontWeight: 600, marginBottom: 2 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: p.color, marginRight: 6 }} />
          {p.name}: {p.value?.toLocaleString('uk-UA')}
        </div>
      ))}
    </div>
  );
}

export default function WarehousePage() {
  const router = useRouter();
  const navigate = (p) => router.push(p);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [period, setPeriod] = useState('30d');

  useEffect(() => {
    const u = api.getUser();
    if (!u || !api.token) { router.push('/login'); return; }
    setUser(u);
  }, []);

  useEffect(() => { if (user) loadData(); }, [user, period]);

  async function loadData() {
    setLoading(true);
    const now = new Date();
    let from;
    if (period === 'mtd') from = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (period === '7d') from = new Date(now - 7*86400000);
    else if (period === '30d') from = new Date(now - 30*86400000);
    else from = new Date(now - 90*86400000);
    const params = `date_from=${from.toISOString().slice(0,10)}&date_to=${now.toISOString().slice(0,10)}`;
    try {
      const res = await api.get(`/api/warehouse?${params}`);
      setData(res);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  if (!user) return null;

  return (
    <div className="app-layout">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo" onClick={() => navigate('/')}>
            <h1>🐾 Practik UA</h1>
            <span>Analytics Dashboard</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-item" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>📊 Аналітика товарів</div>
          <div className="nav-item" onClick={() => navigate('/customers')} style={{ cursor: 'pointer' }}>👤 Клієнти</div>
          <div className="nav-item" onClick={() => navigate('/marketing')} style={{ cursor: 'pointer' }}>📈 Маркетинг</div>
          <div className="nav-item active">🏭 Склад</div>
          <div className="nav-item" onClick={() => navigate('/finance')} style={{ cursor: 'pointer' }}>💰 Фінанси</div>
          <div className="nav-item" onClick={() => navigate('/hr')} style={{ cursor: 'pointer' }}>👥 HR</div>
          <div className="nav-item" onClick={() => navigate('/complaints')} style={{ cursor: 'pointer' }}>📋 Скарги</div>
          {user.role === 'developer' && <div className="nav-item" onClick={() => navigate('/admin')} style={{ cursor: 'pointer' }}>⚙️ Адмін-панель</div>}
        </nav>
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{user.display_name?.[0]}</div>
            <div><div className="user-name">{user.display_name}</div><div className="user-role">{user.role === 'developer' ? '🛠 Розробник' : '👤 Власник'}</div></div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => { api.logout(); router.push('/login'); }}>Вийти</button>
        </div>
      </aside>

      <main className="main-content">
        <div className="mobile-header">
          <button className="burger-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
          <span className="mobile-logo">🐾 Practik UA</span>
          {user.role === 'developer' && <span className="dev-badge">🛠 DEV</span>}
        </div>

        <div className="page-header">
          <div><h2>🏭 Склад</h2><p>Логістика, залишки та відвантаження</p></div>
          <div className="header-actions">
            <NotificationBell />
            {user.role === 'developer' && <span className="dev-badge">🛠 Dev Mode</span>}
          </div>
        </div>

        <div className="filters-bar">
          {['mtd','7d','30d','90d'].map(p => (
            <button key={p} className={`filter-chip ${period===p?'active':''}`} onClick={() => setPeriod(p)}>
              {p === 'mtd' ? 'MTD' : p === '7d' ? '7 днів' : p === '30d' ? '30 днів' : '90 днів'}
            </button>
          ))}
        </div>

        {loading ? <div className="loading-state"><div className="spinner" />Завантаження...</div> : data && (
          <>
            {/* KPI */}
            <div className="kpi-grid">
              <div className="kpi-card"><div className="kpi-icon">📦</div><div className="kpi-label">ЗАМОВЛЕНЬ</div><div className="kpi-value">{fmtNum(data.kpi.ordersCount)} шт</div></div>
              <div className="kpi-card"><div className="kpi-icon">⚖️</div><div className="kpi-label">ВІДВАНТАЖЕНО</div><div className="kpi-value">{fmtKg(data.kpi.shippedKg)}</div></div>
              <div className="kpi-card"><div className="kpi-icon">🧾</div><div className="kpi-label">СЕР. ВАРТІСТЬ ТТН</div><div className="kpi-value">{fmtCurrency(data.kpi.avgTtnCost)}</div></div>
              <div className="kpi-card"><div className="kpi-icon">💲</div><div className="kpi-label">СЕР. ВАРТІСТЬ 1 КГ</div><div className="kpi-value">{fmtCurrency(data.kpi.avgCostPerKg)}</div></div>
              <div className="kpi-card"><div className="kpi-icon">📊</div><div className="kpi-label">ЗАЛИШОК ГП (дні)</div><div className="kpi-value">{data.kpi.stockCoverageDays} дн</div></div>
              <div className="kpi-card"><div className="kpi-icon">🌾</div><div className="kpi-label">ЗАЛИШОК СИРОВИНИ</div><div className="kpi-value">{data.kpi.rawMaterialDays} дн</div></div>
            </div>

            {/* Charts row */}
            <div className="charts-grid">
              <div className="card">
                <h3>📈 Відвантаження по днях</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={data.shipmentSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={v => v?.slice(5)} />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Line type="monotone" dataKey="kg" name="Кг" stroke="#10B981" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="orders" name="Замовлень" stroke="#6366F1" strokeWidth={2} dot={false} yAxisId="right" />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h3>📦 Топ товарів по відвантаженню</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data.topProducts?.slice(0, 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" width={180} tick={{ fill: '#94A3B8', fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="totalKg" name="Кг" fill="#10B981" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Inventory balance + Productivity */}
            <div className="charts-grid">
              <div className="card">
                <h3>📊 Баланс: Надходження vs Відвантаження</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={data.inventoryBalance}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="week_start" tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={v => v?.slice(5)} />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Area type="monotone" dataKey="inbound" name="Надходження" fill="rgba(16,185,129,0.2)" stroke="#10B981" strokeWidth={2} />
                    <Area type="monotone" dataKey="outbound" name="Відвантаження" fill="rgba(239,68,68,0.2)" stroke="#EF4444" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h3>⚡ Продуктивність складу</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, padding: '20px 0' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: '#10B981' }}>{data.productivity?.ordersPerDay}</div>
                    <div style={{ color: '#94A3B8', fontSize: '0.8rem' }}>Замовлень/день</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: '#6366F1' }}>{fmtKg(data.productivity?.kgPerDay)}</div>
                    <div style={{ color: '#94A3B8', fontSize: '0.8rem' }}>Кг/день</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: '#F59E0B' }}>{data.productivity?.avgPickTime} хв</div>
                    <div style={{ color: '#94A3B8', fontSize: '0.8rem' }}>Сер. збірка</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Stock alerts + Expiring */}
            <div className="charts-grid">
              {data.stockAlerts?.length > 0 && (
                <div className="card">
                  <h3>🤖 AI-алерти: Низький залишок</h3>
                  <div className="alerts-list">
                    {data.stockAlerts.map((a, i) => (
                      <div key={i} className={`alert-item ${a.level}`}>
                        <div className="alert-icon">{a.level === 'critical' ? '🔴' : '🟡'}</div>
                        <div className="alert-content">
                          <strong>{a.name}</strong>
                          <p>{a.warehouse}: {Math.round(a.qty_kg)} кг залишок</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.expiringBatches?.length > 0 && (
                <div className="card">
                  <h3>⏰ Термін придатності</h3>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead><tr><th>Партія</th><th>Товар</th><th>Залишок</th><th>Днів</th></tr></thead>
                      <tbody>
                        {data.expiringBatches.map((b, i) => (
                          <tr key={i}>
                            <td>{b.batch_number}</td>
                            <td style={{maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{b.product_name}</td>
                            <td>{Math.round(b.qty_remaining_kg)} кг</td>
                            <td>
                              <span className={`expiry-badge ${b.days_left <= 7 ? 'critical' : b.days_left <= 14 ? 'warning' : 'ok'}`}>
                                {b.days_left} дн
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
    </div>
  );
}
