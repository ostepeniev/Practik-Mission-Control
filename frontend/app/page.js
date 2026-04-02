'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

// ─── Format helpers ─────────────────────────────────────────
function fmtCurrency(v) {
  if (v == null) return '—';
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M ₴';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K ₴';
  return v.toFixed(0) + ' ₴';
}
function fmtNum(v, suffix = '') {
  if (v == null) return '—';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K' + (suffix ? ' ' + suffix : '');
  return v.toFixed(0) + (suffix ? ' ' + suffix : '');
}
function fmtPct(v) { return v == null ? '—' : v.toFixed(1) + '%'; }
function fmtDelta(d, inverse) {
  if (d == null || d === 0) return { text: '0%', cls: 'neutral' };
  const pos = inverse ? d < 0 : d > 0;
  return { text: (d > 0 ? '+' : '') + d.toFixed(1) + '%', cls: pos ? 'positive' : 'negative' };
}

// ─── Tooltip ────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, format }) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;
  return (
    <div style={{
      background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '8px', padding: '8px 12px', fontSize: '0.8rem'
    }}>
      <div style={{ color: '#94A3B8', marginBottom: '2px' }}>{label}</div>
      <div style={{ color: '#F1F5F9', fontWeight: 700 }}>
        {format === 'percent' ? fmtPct(val) : fmtCurrency(val)}
      </div>
    </div>
  );
}

// ─── KPI Card Component ────────────────────────────────────
function KPICard({ title, icon, metric }) {
  if (!metric) return null;
  const val = metric.format === 'currency' ? fmtCurrency(metric.value)
    : metric.format === 'percent' ? fmtPct(metric.value)
    : fmtNum(metric.value, metric.unit);
  const delta = fmtDelta(metric.delta_pct, metric.inverse);
  return (
    <div className="kpi-card">
      <div className="kpi-icon">{icon}</div>
      <div className="kpi-label">{title}</div>
      <div className="kpi-value">{val}</div>
      <span className={`kpi-delta ${delta.cls}`}>
        {delta.cls === 'positive' ? '▲' : delta.cls === 'negative' ? '▼' : '—'} {delta.text}
      </span>
    </div>
  );
}

// ─── Status Badge ──────────────────────────────────────────
function StatusBadge({ status }) {
  const labels = { normal: 'Норма', attention: 'Увага', risk: 'Ризик', critical: 'Критично', new: 'Новий' };
  return <span className={`status-badge ${status}`}>{labels[status] || status}</span>;
}

// ─── Main Dashboard ────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [overview, setOverview] = useState(null);
  const [products, setProducts] = useState(null);
  const [revenueSeries, setRevenueSeries] = useState([]);
  const [marginSeries, setMarginSeries] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [insights, setInsights] = useState([]);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiResponse, setAiResponse] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiConversationId, setAiConversationId] = useState(null);
  const [sortBy, setSortBy] = useState('revenue');
  const [sortDir, setSortDir] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('mtd');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState([]);
  const [complaintKpi, setComplaintKpi] = useState(null);
  const [productSearch, setProductSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [productPage, setProductPage] = useState(1);

  useEffect(() => {
    const u = api.getUser();
    if (!u || !api.token) { router.push('/login'); return; }
    setUser(u);
    loadData();
  }, []);

  useEffect(() => { if (user) loadData(); }, [period, categoryFilter, sortBy, sortDir, productSearch, statusFilter, productPage]);

  async function loadData() {
    setLoading(true);
    const now = new Date();
    let date_from, date_to = now.toISOString().slice(0, 10);
    if (period === 'mtd') {
      date_from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    } else if (period === '7d') {
      date_from = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
    } else if (period === '30d') {
      date_from = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
    } else if (period === '90d') {
      date_from = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
    }

    const params = { date_from, date_to };
    if (categoryFilter) params.category_id = categoryFilter;

    try {
      const [ov, prod, rev, margin, topP, topC, al, ins] = await Promise.all([
        api.getOverview(params),
        api.getProducts({ ...params, sort_by: sortBy, sort_dir: sortDir, search: productSearch, status: statusFilter, page: productPage, page_size: 20 }),
        api.getSeries('revenue', params),
        api.getSeries('margin', params),
        api.getTopProducts(params),
        api.getTopCustomers(params),
        api.getAlerts(params),
        api.getInsights(6),
      ]);
      setOverview(ov);
      setProducts(prod);
      setRevenueSeries(rev?.series || []);
      setMarginSeries(margin?.series || []);
      setTopProducts(topP?.items || []);
      setTopCustomers(topC?.items || []);
      setAlerts(al?.alerts || []);
      setInsights(ins?.insights || []);

      // Load complaints KPI
      try {
        const cSumm = await api.getComplaintsSummary(params);
        setComplaintKpi(cSumm?.kpi || null);
      } catch (e) { /* ignore */ }

      // Load categories for filter
      if (user?.role === 'developer') {
        try { const c = await api.getCategories(); setCategories(c?.categories || []); }
        catch (e) { /* ignore */ }
      }
    } catch (e) {
      console.error('Load error:', e);
    }
    setLoading(false);
  }

  async function handleAskAI(e) {
    e.preventDefault();
    if (!aiQuestion.trim()) return;
    setAiLoading(true);
    setAiResponse(null);
    try {
      const res = await api.sendAIMessage(aiQuestion, aiConversationId);
      if (res.conversation_id) setAiConversationId(res.conversation_id);
      setAiResponse(res);
    } catch (e) {
      setAiResponse({ content: 'Помилка з\'єднання з AI', tools_used: [], error: true });
    }
    setAiQuestion('');
    setAiLoading(false);
  }

  function handleSort(col) {
    if (sortBy === col) { setSortDir(d => d === 'desc' ? 'asc' : 'desc'); }
    else { setSortBy(col); setSortDir('desc'); }
  }

  function handleLogout() {
    api.logout();
    router.push('/login');
  }

  if (!user) return null;

  const m = overview?.metrics || {};

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
          <div className="nav-item active" onClick={() => navigate('/')}>📊 Аналітика товарів</div>
          <div className="nav-item" onClick={() => navigate('/marketing')} style={{ cursor: 'pointer' }}>📈 Маркетинг</div>
          <div className="nav-item" style={{ opacity: 0.5 }}>🏭 Склад</div>
          <div className="nav-item" style={{ opacity: 0.5 }}>💰 Фінанси</div>
          <div className="nav-item" style={{ opacity: 0.5 }}>👥 HR</div>
          <div className="nav-item" onClick={() => navigate('/complaints')} style={{ cursor: 'pointer' }}>📋 Скарги</div>
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
          <button className="btn btn-secondary btn-sm" onClick={handleLogout}>Вийти</button>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        <div className="page-header">
          <div>
            <h2>📊 Аналітика товарів</h2>
            <p>Щоденний контроль продажів і маржинальності</p>
          </div>
          {user.role === 'developer' && <span className="dev-badge">🛠 Dev Mode</span>}
        </div>

        {/* Filters */}
        <div className="filters-bar">
          {['mtd', '7d', '30d', '90d'].map(p => (
            <button key={p} className={`filter-chip ${period === p ? 'active' : ''}`}
                    onClick={() => setPeriod(p)}>
              {p === 'mtd' ? 'MTD' : p === '7d' ? '7 днів' : p === '30d' ? '30 днів' : '90 днів'}
            </button>
          ))}
          {categories.length > 0 && (
            <select className="filter-select" value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}>
              <option value="">Всі категорії</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>

        {loading ? (
          <div className="loading-spinner"><div className="spinner" /></div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="kpi-grid">
              <KPICard title="Виторг MTD" icon="💰" metric={m.revenue_mtd} />
              <KPICard title="Валова маржа %" icon="📈" metric={m.gross_margin_pct} />
              <KPICard title="Валова маржа ₴" icon="💵" metric={m.gross_margin_amount} />
              <KPICard title="Обсяг продажів" icon="📦" metric={m.sales_volume} />
              <KPICard title="К-ть замовлень" icon="🛒" metric={m.order_count} />
              <KPICard title="Повернення %" icon="↩️" metric={m.returns_pct} />
              {complaintKpi && (
                <div className="kpi-card">
                  <div className="kpi-icon">📋</div>
                  <div className="kpi-label">Скарги</div>
                  <div className="kpi-value">{complaintKpi.total}</div>
                  <span className={`kpi-delta ${complaintKpi.delta_pct > 0 ? 'negative' : complaintKpi.delta_pct < 0 ? 'positive' : 'neutral'}`}
                        onClick={() => router.push('/complaints')} style={{ cursor: 'pointer' }}>
                    {complaintKpi.delta_pct > 0 ? '▲' : complaintKpi.delta_pct < 0 ? '▼' : '—'} {complaintKpi.delta_pct > 0 ? '+' : ''}{complaintKpi.delta_pct}%
                  </span>
                </div>
              )}
            </div>

            {/* Charts Row 1 */}
            <div className="charts-grid">
              <div className="card chart-card">
                <div className="card-title">📈 Виторг по днях</div>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={revenueSeries}>
                    <defs>
                      <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2ECC71" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#2ECC71" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={d => d?.slice(5)} />
                    <YAxis tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => v >= 1000 ? (v/1000).toFixed(0)+'K' : v} />
                    <Tooltip content={<ChartTooltip format="currency" />} />
                    <Area type="monotone" dataKey="value" stroke="#2ECC71" strokeWidth={2}
                          fill="url(#greenGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="card chart-card">
                <div className="card-title">📊 Маржинальність по днях</div>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={marginSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={d => d?.slice(5)} />
                    <YAxis tick={{ fill: '#64748B', fontSize: 11 }} domain={['auto', 'auto']} tickFormatter={v => v+'%'} />
                    <Tooltip content={<ChartTooltip format="percent" />} />
                    <Line type="monotone" dataKey="value" stroke="#3498DB" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Charts Row 2: Top Products + Alerts */}
            <div className="charts-row">
              <div className="card chart-card">
                <div className="card-title">🏆 Топ-5 SKU по виручці</div>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={topProducts} layout="vertical" margin={{ left: 100 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => v >= 1000 ? (v/1000).toFixed(0)+'K' : v} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} width={100}
                           tickFormatter={n => n?.length > 18 ? n.slice(0,18)+'…' : n} />
                    <Tooltip content={<ChartTooltip format="currency" />} />
                    <Bar dataKey="revenue" fill="#2ECC71" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="card">
                <div className="card-title">🔔 Алерти</div>
                <div className="alert-list">
                  {alerts.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '16px' }}>
                      ✅ Немає активних алертів
                    </div>
                  ) : alerts.slice(0, 8).map((a, i) => (
                    <div key={i} className={`alert-item ${a.severity}`}
                         onClick={() => router.push(`/products/${a.product_id}`)}
                         style={{ cursor: 'pointer' }}>
                      <div>
                        <div className="alert-product">
                          <StatusBadge status={a.severity} /> {a.product_name}
                        </div>
                        <div className="alert-message">{a.message}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Products Table */}
            <div className="card data-table-wrapper">
              <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span>📋 Всі товари ({products?.total_count || 0})</span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={productSearch}
                    onChange={e => { setProductSearch(e.target.value); setProductPage(1); }}
                    placeholder="🔍 Пошук товару..."
                    style={{
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px', padding: '6px 12px', color: 'var(--text-primary)',
                      fontSize: '0.8rem', width: '200px', outline: 'none',
                    }}
                  />
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      const now = new Date();
                      let df;
                      if (period === 'mtd') df = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
                      else if (period === '7d') df = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
                      else if (period === '30d') df = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
                      else df = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
                      api.exportCSV('products', { date_from: df, date_to: now.toISOString().slice(0, 10) });
                    }}
                    title="Експорт в CSV"
                  >📥 CSV</button>
                </div>
              </div>

              {/* Status Filter Chips */}
              {products?.status_summary && (
                <div style={{ display: 'flex', gap: '6px', padding: '0 16px 12px', flexWrap: 'wrap' }}>
                  <button
                    className={`filter-chip ${!statusFilter ? 'active' : ''}`}
                    onClick={() => { setStatusFilter(''); setProductPage(1); }}
                  >Всі ({products.total_count})</button>
                  {products.status_summary.critical > 0 && (
                    <button className={`filter-chip ${statusFilter === 'critical' ? 'active' : ''}`}
                      onClick={() => { setStatusFilter(statusFilter === 'critical' ? '' : 'critical'); setProductPage(1); }}
                      style={{ borderColor: 'var(--color-critical)' }}
                    >🔴 Критично ({products.status_summary.critical})</button>
                  )}
                  {products.status_summary.risk > 0 && (
                    <button className={`filter-chip ${statusFilter === 'risk' ? 'active' : ''}`}
                      onClick={() => { setStatusFilter(statusFilter === 'risk' ? '' : 'risk'); setProductPage(1); }}
                      style={{ borderColor: 'var(--color-risk)' }}
                    >🟠 Ризик ({products.status_summary.risk})</button>
                  )}
                  {products.status_summary.attention > 0 && (
                    <button className={`filter-chip ${statusFilter === 'attention' ? 'active' : ''}`}
                      onClick={() => { setStatusFilter(statusFilter === 'attention' ? '' : 'attention'); setProductPage(1); }}
                      style={{ borderColor: 'var(--color-attention)' }}
                    >🟡 Увага ({products.status_summary.attention})</button>
                  )}
                  <button className={`filter-chip ${statusFilter === 'normal' ? 'active' : ''}`}
                    onClick={() => { setStatusFilter(statusFilter === 'normal' ? '' : 'normal'); setProductPage(1); }}
                  >✅ Норма ({products.status_summary.normal})</button>
                  {products.status_summary.new > 0 && (
                    <button className={`filter-chip ${statusFilter === 'new' ? 'active' : ''}`}
                      onClick={() => { setStatusFilter(statusFilter === 'new' ? '' : 'new'); setProductPage(1); }}
                    >🆕 Нові ({products.status_summary.new})</button>
                  )}
                </div>
              )}

              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      {[
                        ['name', 'Товар'], ['category', 'Категорія'], ['revenue', 'Виторг'],
                        ['margin_pct', 'Маржа %'], ['margin_amount', 'Маржа ₴'],
                        ['quantity', 'К-ть'], ['avg_price', 'Сер. ціна'],
                        ['delta_revenue_pct', 'Δ Виторг'], ['delta_margin_pp', 'Δ Маржа'],
                        ['status', 'Статус']
                      ].map(([key, label]) => (
                        <th key={key} className={sortBy === key ? 'sorted' : ''} onClick={() => handleSort(key)}>
                          {label} {sortBy === key ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(products?.products || []).map(p => {
                      const dRev = fmtDelta(p.delta_revenue_pct, false);
                      const dMargin = fmtDelta(p.delta_margin_pp, false);
                      return (
                        <tr key={p.id} onClick={() => router.push(`/products/${p.id}`)}>
                          <td>
                            <strong>{p.name}</strong>
                            <br /><span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{p.sku}</span>
                          </td>
                          <td>{p.category}</td>
                          <td>{fmtCurrency(p.revenue)}</td>
                          <td>{fmtPct(p.margin_pct)}</td>
                          <td>{fmtCurrency(p.margin_amount)}</td>
                          <td>{fmtNum(p.quantity)}</td>
                          <td>{fmtCurrency(p.avg_price)}</td>
                          <td><span className={`kpi-delta ${dRev.cls}`} style={{ fontSize: '0.78rem' }}>{dRev.text}</span></td>
                          <td><span className={`kpi-delta ${dMargin.cls}`} style={{ fontSize: '0.78rem' }}>{dMargin.text}</span></td>
                          <td><StatusBadge status={p.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {products?.total_pages > 1 && (
                <div style={{
                  display: 'flex', justifyContent: 'center', alignItems: 'center',
                  gap: '8px', padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.06)',
                }}>
                  <button
                    className="filter-chip"
                    disabled={productPage <= 1}
                    onClick={() => setProductPage(p => Math.max(1, p - 1))}
                  >◀</button>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    {productPage} / {products.total_pages}
                  </span>
                  <button
                    className="filter-chip"
                    disabled={productPage >= products.total_pages}
                    onClick={() => setProductPage(p => p + 1)}
                  >▶</button>
                </div>
              )}
            </div>

            {/* Bottom: Customers + AI */}
            <div className="bottom-grid">
              <div className="card">
                <div className="card-title">👥 Топ-5 клієнтів</div>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Клієнт</th><th>Виторг</th><th>Замовлень</th><th>Маржа %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topCustomers.map((c, i) => (
                        <tr key={c.id}>
                          <td>
                            <strong>{c.name}</strong>
                            <br /><span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{c.region} · {c.channel}</span>
                          </td>
                          <td>{fmtCurrency(c.revenue)}</td>
                          <td>{c.orders}</td>
                          <td>{fmtPct(c.margin_pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="card ai-panel">
                <div className="card-title">🤖 AI Інсайти</div>
                {insights.slice(0, 4).map(ins => (
                  <div key={ins.id} className="ai-insight"
                       onClick={() => ins.product_id && router.push(`/products/${ins.product_id}`)}
                       style={{ cursor: ins.product_id ? 'pointer' : 'default' }}>
                    <div className="ai-insight-header">
                      <span className={`ai-insight-type ${ins.type}`}>{
                        { anomaly: '⚠️ Аномалія', risk: '🔴 Ризик', recommendation: '💡 Рекомендація', insight: '📊 Інсайт' }[ins.type] || ins.type
                      }</span>
                      <span className="ai-insight-title">{ins.title}</span>
                    </div>
                    <div className="ai-insight-body">{ins.body}</div>
                    {ins.confidence && <div className="ai-confidence">Впевненість: {(ins.confidence * 100).toFixed(0)}%</div>}
                  </div>
                ))}
                <form onSubmit={handleAskAI} className="ai-chat-input">
                  <input
                    id="ai-question-input"
                    value={aiQuestion}
                    onChange={e => setAiQuestion(e.target.value)}
                    placeholder="Запитайте AI... (напр. 'чому впала маржа по сухому корму?')"
                  />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={aiLoading}>
                    {aiLoading ? '⏳' : '🚀'}
                  </button>
                </form>
                {aiResponse && (
                  <div className="ai-response">
                    <div className="ai-response-label">
                      🤖 AI відповідь
                      {aiResponse.tools_used?.length > 0 && (
                        <span style={{ fontSize: '0.7rem', marginLeft: '8px', color: 'var(--text-muted)' }}>
                          📊 {aiResponse.tools_used.join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="ai-response-text" style={{ whiteSpace: 'pre-wrap' }}>
                      {aiResponse.content}
                    </div>
                    {aiConversationId && (
                      <button className="filter-chip" style={{ marginTop: '8px', fontSize: '0.7rem' }}
                              onClick={() => { setAiConversationId(null); setAiResponse(null); }}>
                        🔄 Новий діалог
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
