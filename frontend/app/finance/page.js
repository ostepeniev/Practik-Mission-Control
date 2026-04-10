'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import NotificationBell from '@/app/components/NotificationBell';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

function fmtCurrency(v) {
  if (v == null) return '—';
  if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(1)+'M ₴';
  if (Math.abs(v) >= 1000) return (v/1000).toFixed(1)+'K ₴';
  return Math.round(v)+' ₴';
}
function fmtNum(v) { return v == null ? '—' : v.toLocaleString('uk-UA'); }
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
          {p.name}: {fmtCurrency(p.value)}
        </div>
      ))}
    </div>
  );
}

const PIE_COLORS = ['#10B981', '#6366F1', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];

export default function FinancePage() {
  const router = useRouter();
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
      const res = await api.get(`/api/finance?${params}`);
      setData(res);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  if (!user) return null;

  function navigate(path) { setSidebarOpen(false); router.push(path); }

  return (
    <div className="app-layout">
      <header className="mobile-header">
        <button className={`burger-btn${sidebarOpen ? ' open' : ''}`}
          onClick={() => setSidebarOpen(o => !o)} aria-label="Меню">
          <span className="burger-line" /><span className="burger-line" /><span className="burger-line" />
        </button>
        <span className="mobile-header-logo">🐾 Practik UA</span>
        {user.role === 'developer' && <span className="dev-badge">🛠 Dev</span>}
      </header>

      <div className={`sidebar-overlay${sidebarOpen ? ' visible' : ''}`} onClick={() => setSidebarOpen(false)} />

      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <div>
            <h1>🐾 Practik UA</h1>
            <span>Mission Control</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-item" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>📊 Аналітика товарів</div>
          <div className="nav-item" onClick={() => navigate('/customers')} style={{ cursor: 'pointer' }}>👤 Клієнти</div>
          <div className="nav-item" onClick={() => navigate('/marketing')} style={{ cursor: 'pointer' }}>📈 Маркетинг</div>
          <div className="nav-item" onClick={() => navigate('/warehouse')} style={{ cursor: 'pointer' }}>🏭 Склад</div>
          <div className="nav-item active">💰 Фінанси</div>
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

        <div className="page-header">
          <div><h2>💰 Фінанси</h2><p>P&L, дебіторка, кредиторка, cashflow</p></div>
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
              <div className="kpi-card"><div className="kpi-icon">💵</div><div className="kpi-label">ВИТОРГ MTD</div><div className="kpi-value">{fmtCurrency(data.kpi.revenueMTD)}</div><DeltaBadge value={data.kpi.revenueDelta} /></div>
              <div className="kpi-card"><div className="kpi-icon">📊</div><div className="kpi-label">ВАЛОВА МАРЖА %</div><div className="kpi-value">{data.kpi.marginPct}%</div></div>
              <div className="kpi-card"><div className="kpi-icon">💰</div><div className="kpi-label">МАРЖА СУМА</div><div className="kpi-value">{fmtCurrency(data.kpi.marginSum)}</div></div>
              <div className="kpi-card"><div className="kpi-icon">📋</div><div className="kpi-label">ПРОСТРОЧЕНА ДЕБІТОРКА</div><div className="kpi-value" style={{color: data.kpi.overdueReceivables > 100000 ? '#EF4444' : '#F59E0B'}}>{fmtCurrency(data.kpi.overdueReceivables)}</div></div>
              <div className="kpi-card"><div className="kpi-icon">📑</div><div className="kpi-label">КРЕДИТОРКА</div><div className="kpi-value">{fmtCurrency(data.kpi.totalPayables)}</div></div>
              <div className="kpi-card"><div className="kpi-icon">💸</div><div className="kpi-label">CASHFLOW</div><div className="kpi-value" style={{color: data.kpi.cashflow >= 0 ? '#10B981' : '#EF4444'}}>{fmtCurrency(data.kpi.cashflow)}</div></div>
            </div>

            {/* Revenue + Cashflow */}
            <div className="charts-grid">
              <div className="card">
                <h3>📈 Виторг по днях</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={data.revenueSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={v => v?.slice(5)} />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={v => fmtCurrency(v)} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="revenue" name="Виторг" stroke="#10B981" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h3>💸 Cashflow по тижнях</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={data.cashflowSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="week_start" tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={v => v?.slice(5)} />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={v => fmtCurrency(v)} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Area type="monotone" dataKey="income" name="Надходження" fill="rgba(16,185,129,0.2)" stroke="#10B981" strokeWidth={2} />
                    <Area type="monotone" dataKey="expenses" name="Витрати" fill="rgba(239,68,68,0.2)" stroke="#EF4444" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Margin by category + Expense PieChart */}
            <div className="charts-grid">
              <div className="card">
                <h3>📊 Маржинальність по категоріях</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data.marginByCategory?.slice(0, 8)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="category" tick={{ fill: '#94A3B8', fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={v => v+'%'} />
                    <Tooltip formatter={(v) => v?.toFixed(1)+'%'} contentStyle={{ background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                    <Bar dataKey="margin_pct" name="Маржа %" fill="#6366F1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h3>🍩 Структура витрат</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={data.expenseStructure} dataKey="total" nameKey="category" cx="50%" cy="50%" outerRadius={100} innerRadius={55} paddingAngle={2} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={{ stroke: '#94A3B8' }}>
                      {data.expenseStructure?.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmtCurrency(v)} contentStyle={{ background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Receivables + Payables tables */}
            <div className="charts-grid">
              <div className="card">
                <h3>📋 Дебіторка по клієнтах</h3>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th>Клієнт</th><th>Рахунок</th><th>Сума</th><th>Сплачено</th><th>Прострочено</th></tr></thead>
                    <tbody>
                      {data.receivablesList?.map((r, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.customer_name}</td>
                          <td style={{ fontSize: '0.8rem', color: '#94A3B8' }}>{r.invoice_number}</td>
                          <td>{fmtCurrency(r.amount)}</td>
                          <td style={{ color: '#10B981' }}>{fmtCurrency(r.paid_amount)}</td>
                          <td>
                            <span className={`expiry-badge ${r.days_overdue > 30 ? 'critical' : r.days_overdue > 14 ? 'warning' : 'ok'}`}>
                              {r.days_overdue > 0 ? `${r.days_overdue} дн` : '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <h3>📑 Кредиторка по постачальниках</h3>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th>Постачальник</th><th>Категорія</th><th>Сума</th><th>Сплачено</th><th>До сплати</th></tr></thead>
                    <tbody>
                      {data.payablesList?.map((p, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{p.supplier_name}</td>
                          <td style={{ fontSize: '0.8rem', color: '#94A3B8' }}>{p.category}</td>
                          <td>{fmtCurrency(p.amount)}</td>
                          <td style={{ color: '#10B981' }}>{fmtCurrency(p.paid_amount)}</td>
                          <td style={{ fontWeight: 600 }}>{fmtCurrency(p.amount - p.paid_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Purchase price alerts */}
            {data.purchasePriceAlerts?.length > 0 && (
              <div className="card">
                <h3>🌾 Відхилення закупівельної ціни від ринку</h3>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th>Сировина</th><th>Постачальник</th><th>Ціна, ₴/кг</th><th>Ринкова</th><th>Різниця</th></tr></thead>
                    <tbody>
                      {data.purchasePriceAlerts.map((p, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{p.material_name}</td>
                          <td style={{ fontSize: '0.8rem', color: '#94A3B8' }}>{p.supplier}</td>
                          <td>{p.price_per_kg} ₴</td>
                          <td>{p.market_avg_price} ₴</td>
                          <td>
                            <span style={{ color: p.delta_pct > 10 ? '#EF4444' : p.delta_pct > 5 ? '#F59E0B' : '#10B981', fontWeight: 600 }}>
                              {p.delta_pct > 0 ? '+' : ''}{p.delta_pct?.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* AI Alerts */}
            {data.alerts?.length > 0 && (
              <div className="card">
                <h3>🤖 AI-аналітик: Фінансові інсайти</h3>
                <div className="alerts-list">
                  {data.alerts.map((a, i) => (
                    <div key={i} className={`alert-item ${a.type}`}>
                      <div className="alert-icon">{a.type === 'critical' ? '🔴' : a.type === 'warning' ? '🟡' : '🟢'}</div>
                      <div className="alert-content">
                        <strong>{a.title}</strong>
                        <p>{a.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
