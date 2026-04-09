'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import NotificationBell from '@/app/components/NotificationBell';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, ComposedChart,
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
  return (
    <div style={{
      background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '8px', padding: '8px 12px', fontSize: '0.8rem'
    }}>
      <div style={{ color: '#94A3B8', marginBottom: '2px' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || '#F1F5F9', fontWeight: 700, fontSize: '0.82rem' }}>
          {p.name === 'margin' ? fmtPct(p.value) : fmtCurrency(p.value)}
        </div>
      ))}
    </div>
  );
}

// ─── Plan/Fact SVG Gauge ────────────────────────────────────
function PlanGauge({ label, pct, fact, format }) {
  const clamped = Math.min(pct || 0, 120);
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(clamped, 100) / 100) * circumference;
  const color = clamped >= 100 ? '#2ECC71' : clamped >= 80 ? '#F39C12' : '#E74C3C';
  const factStr = format === 'currency' ? fmtCurrency(fact) : format === 'percent' ? fmtPct(fact) : fmtNum(fact);

  return (
    <div className="plan-gauge">
      <svg width="84" height="84" viewBox="0 0 84 84">
        <circle cx="42" cy="42" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle cx="42" cy="42" r={radius} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 42 42)"
          style={{ transition: 'stroke-dashoffset 1s ease-out' }} />
        <text x="42" y="40" textAnchor="middle" fill={color} fontSize="16" fontWeight="800">
          {Math.round(clamped)}%
        </text>
        <text x="42" y="54" textAnchor="middle" fill="#64748B" fontSize="8" fontWeight="500">
          ПЛАН
        </text>
      </svg>
      <div className="plan-gauge-label">{label}</div>
      <div className="plan-gauge-fact">{factStr}</div>
    </div>
  );
}

// ─── KPI Card Component (clickable for drill-down) ─────────
function KPICard({ title, icon, metric, onClick }) {
  if (!metric) return null;
  const val = metric.format === 'currency' ? fmtCurrency(metric.value)
    : metric.format === 'percent' ? fmtPct(metric.value)
    : fmtNum(metric.value, metric.unit);
  const delta = fmtDelta(metric.delta_pct, metric.inverse);
  return (
    <div className={`kpi-card${onClick ? ' clickable' : ''}`} onClick={onClick}>
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

// ─── Drill-Down Modal ──────────────────────────────────────
function DrillDownModal({ title, items, onClose, onDrillDeeper, valueFmt, router }) {
  if (!items) return null;
  const maxVal = Math.max(...items.map(i => i.value || i.revenue || 0), 1);
  const colors = ['#2ECC71', '#3498DB', '#9B59B6', '#F39C12', '#E74C3C', '#1ABC9C', '#E67E22', '#2980B9', '#8E44AD'];

  return (
    <div className="drilldown-overlay" onClick={onClose}>
      <div className="drilldown-modal" onClick={e => e.stopPropagation()}>
        <div className="drilldown-header">
          <h3>{title}</h3>
          <button className="drilldown-close" onClick={onClose}>✕</button>
        </div>

        {items.map((item, i) => {
          const val = item.value || item.revenue || item.count || 0;
          const pct = (val / maxVal) * 100;
          const delta = item.delta_pct;
          const deltaD = delta != null ? fmtDelta(delta) : null;

          return (
            <div key={item.id || i} className="drilldown-bar-row"
              onClick={() => onDrillDeeper?.(item)}>
              <div className="drilldown-bar-name">{item.name}</div>
              <div className="drilldown-bar-track">
                <div className="drilldown-bar-fill"
                  style={{ width: pct + '%', background: colors[i % colors.length] }} />
              </div>
              <div className="drilldown-bar-value">
                {valueFmt === 'count' ? val : fmtCurrency(val)}
              </div>
              {deltaD && (
                <div className={`drilldown-bar-delta kpi-delta ${deltaD.cls}`}>
                  {deltaD.text}
                </div>
              )}
            </div>
          );
        })}

        {onDrillDeeper && (
          <div className="drilldown-footer">
            <button className="btn btn-secondary btn-sm" onClick={onClose}>
              Закрити
            </button>
          </div>
        )}
      </div>
    </div>
  );
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
  // New states for features
  const [pulseSummary, setPulseSummary] = useState(null);
  const [pulseLoading, setPulseLoading] = useState(false);
  const [drilldown, setDrilldown] = useState(null); // { metric, title, items }
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  // Dual chart merged data  
  const [dualChartData, setDualChartData] = useState([]);

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

      // Merge revenue + margin into dual chart data
      const revMap = {};
      (rev?.series || []).forEach(r => { revMap[r.date] = r.value; });
      const merged = (margin?.series || []).map(m => ({
        date: m.date, revenue: revMap[m.date] || 0, margin: m.value,
      }));
      setDualChartData(merged);

      // Load AI Pulse (non-blocking)
      if (ov?.metrics) {
        loadPulse(ov.metrics, ov.plan_fact, ov.period);
      }

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

  async function loadPulse(metrics, planFact, period) {
    setPulseLoading(true);
    try {
      const res = await api.getAIPulse(metrics, planFact, period);
      setPulseSummary(res.summary);
    } catch (e) {
      setPulseSummary(null);
    }
    setPulseLoading(false);
  }

  // ─── Drill-Down handlers ────────────────────────────────
  const getDateParams = useCallback(() => {
    const now = new Date();
    let date_from, date_to = now.toISOString().slice(0, 10);
    if (period === 'mtd') date_from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    else if (period === '7d') date_from = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
    else if (period === '30d') date_from = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
    else date_from = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
    return { date_from, date_to };
  }, [period]);

  async function openDrilldown(metric) {
    setDrilldownLoading(true);
    const params = getDateParams();
    let title = '', groupBy = '', valueFmt = 'currency';

    switch (metric) {
      case 'revenue': title = '💰 Виторг по категоріях'; groupBy = 'category'; break;
      case 'margin': title = '📉 Найбільше падіння маржі'; groupBy = 'margin_drop'; break;
      case 'orders': title = '🛒 Замовлення по каналах'; groupBy = 'channel'; break;
      case 'returns': title = '↩️ Повернення по причинах'; groupBy = 'return_reason'; valueFmt = 'count'; break;
      case 'volume': title = '📦 Обсяг по категоріях'; groupBy = 'category'; break;
      default: title = '📊 Breakdown'; groupBy = 'category';
    }

    try {
      const res = await api.getBreakdown({ ...params, metric, group_by: groupBy });
      setDrilldown({
        metric, title, items: res.items, valueFmt,
        onDrillDeeper: (item) => {
          if (item.id && groupBy === 'category') {
            // Level 2: products in this category
            loadCategoryProducts(item.id, item.name, params);
          } else if (item.id && typeof item.id === 'number') {
            router.push(`/products/${item.id}`);
          }
        }
      });
    } catch (e) {
      console.error('Drilldown error:', e);
    }
    setDrilldownLoading(false);
  }

  async function loadCategoryProducts(categoryId, categoryName, dateParams) {
    try {
      const res = await api.getBreakdown({ ...dateParams, metric: 'revenue', group_by: 'product', category_id: categoryId });
      setDrilldown({
        metric: 'product', title: `📦 ${categoryName} — Товари`,
        items: res.items, valueFmt: 'currency',
        onDrillDeeper: (item) => router.push(`/products/${item.id}`),
      });
    } catch (e) {
      console.error('Category products error:', e);
    }
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
  const pf = overview?.plan_fact;

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
            <span>Mission Control</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-item active" onClick={() => navigate('/')}>📊 Аналітика товарів</div>
          <div className="nav-item" onClick={() => navigate('/customers')} style={{ cursor: 'pointer' }}>👤 Клієнти</div>
          <div className="nav-item" onClick={() => navigate('/marketing')} style={{ cursor: 'pointer' }}>📈 Маркетинг</div>
          <div className="nav-item" onClick={() => navigate('/warehouse')} style={{ cursor: 'pointer' }}>🏭 Склад</div>
          <div className="nav-item" onClick={() => navigate('/finance')} style={{ cursor: 'pointer' }}>💰 Фінанси</div>
          <div className="nav-item" onClick={() => navigate('/hr')} style={{ cursor: 'pointer' }}>👥 HR</div>
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
          <div className="header-actions">
            <NotificationBell />
            {user.role === 'developer' && <span className="dev-badge">🛠 Dev Mode</span>}
          </div>
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
            {/* ═══ CEO PULSE BLOCK ═══ */}
            <div className="pulse-block">
              <div className="pulse-summary">
                <div className="pulse-summary-label">
                  <span className="pulse-dot" />
                  Пульс бізнесу
                </div>
                <div className="pulse-summary-text">
                  {pulseLoading ? (
                    <span className="pulse-loading">⏳ Аналізую показники...</span>
                  ) : pulseSummary ? (
                    pulseSummary
                  ) : (
                    <span className="pulse-loading">Завантаження AI-аналізу...</span>
                  )}
                </div>
              </div>
              {pf && (
                <div className="plan-gauges">
                  <PlanGauge label="Виторг" pct={pf.revenue?.pct} fact={pf.revenue?.fact} format="currency" />
                  <PlanGauge label="Маржа" pct={pf.margin_pct?.pct} fact={pf.margin_pct?.fact} format="percent" />
                  <PlanGauge label="Замовлення" pct={pf.orders?.pct} fact={pf.orders?.fact} format="number" />
                </div>
              )}
            </div>

            {/* KPI Cards (clickable for drill-down) */}
            <div className="kpi-grid">
              <KPICard title="Виторг MTD" icon="💰" metric={m.revenue_mtd}
                onClick={() => openDrilldown('revenue')} />
              <KPICard title="Валова маржа %" icon="📈" metric={m.gross_margin_pct}
                onClick={() => openDrilldown('margin')} />
              <KPICard title="Валова маржа ₴" icon="💵" metric={m.gross_margin_amount} />
              <KPICard title="Обсяг продажів" icon="📦" metric={m.sales_volume}
                onClick={() => openDrilldown('volume')} />
              <KPICard title="К-ть замовлень" icon="🛒" metric={m.order_count}
                onClick={() => openDrilldown('orders')} />
              <KPICard title="Середній чек" icon="🧾" metric={m.avg_check} />
              <KPICard title="Повернення %" icon="↩️" metric={m.returns_pct}
                onClick={() => openDrilldown('returns')} />
              {complaintKpi && (
                <div className="kpi-card clickable" onClick={() => router.push('/complaints')}>
                  <div className="kpi-icon">📋</div>
                  <div className="kpi-label">Скарги</div>
                  <div className="kpi-value">{complaintKpi.total}</div>
                  <span className={`kpi-delta ${complaintKpi.delta_pct > 0 ? 'negative' : complaintKpi.delta_pct < 0 ? 'positive' : 'neutral'}`}>
                    {complaintKpi.delta_pct > 0 ? '▲' : complaintKpi.delta_pct < 0 ? '▼' : '—'} {complaintKpi.delta_pct > 0 ? '+' : ''}{complaintKpi.delta_pct}%
                  </span>
                </div>
              )}
              {m.customers && (
                <div className="kpi-card clickable" onClick={() => router.push('/customers')}>
                  <div className="kpi-icon">👥</div>
                  <div className="kpi-label">Клієнти</div>
                  <div className="kpi-value">{m.customers.total}</div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    🆕 {m.customers.new} · 🔄 {m.customers.returning}
                  </span>
                </div>
              )}
            </div>

            {/* Dual-Axis Chart: Revenue (bars) + Margin (line) */}
            <div className="charts-grid">
              <div className="card chart-card">
                <div className="card-title">📈 Виторг та маржинальність по днях</div>
                <div className="dual-chart-legend">
                  <div className="dual-chart-legend-item">
                    <div className="dual-chart-legend-dot" style={{ background: '#2ECC71' }} /> Виторг
                  </div>
                  <div className="dual-chart-legend-item">
                    <div className="dual-chart-legend-dot" style={{ background: '#3498DB' }} /> Маржа %
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={dualChartData}>
                    <defs>
                      <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2ECC71" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#2ECC71" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={d => d?.slice(5)} />
                    <YAxis yAxisId="left" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => v >= 1000 ? (v/1000).toFixed(0)+'K' : v} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: '#3498DB', fontSize: 11 }} tickFormatter={v => v+'%'} domain={['auto', 'auto']} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar yAxisId="left" dataKey="revenue" name="revenue" fill="url(#greenGrad)" stroke="#2ECC71" radius={[2, 2, 0, 0]} />
                    <Line yAxisId="right" dataKey="margin" name="margin" stroke="#3498DB" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="card chart-card">
                <div className="card-title">🔔 Алерти & AI-гіпотези</div>
                <div className="alert-list">
                  {alerts.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '16px' }}>
                      ✅ Немає активних алертів
                    </div>
                  ) : alerts.slice(0, 8).map((a, i) => (
                    <div key={i} className={`alert-item ${a.severity}`}
                         onClick={() => router.push(`/products/${a.product_id}`)}
                         style={{ cursor: 'pointer', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <div>
                          <div className="alert-product">
                            <StatusBadge status={a.severity} /> {a.product_name}
                          </div>
                          <div className="alert-message">{a.message}</div>
                        </div>
                      </div>
                      {a.hypotheses?.length > 0 && (
                        <div style={{ marginTop: '6px', paddingLeft: '4px', borderLeft: '2px solid rgba(155,89,182,0.3)' }}>
                          {a.hypotheses.slice(0, 2).map((h, j) => (
                            <div key={j} style={{ fontSize: '0.73rem', color: 'var(--accent-purple)', lineHeight: 1.4, marginBottom: '2px' }}>
                              {h.icon} {h.text}
                              <span style={{ opacity: 0.5, marginLeft: '4px' }}>({Math.round(h.confidence * 100)}%)</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Charts Row 2: Top Products */}
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
                <div className="card-title">👤 Клієнтська база</div>
                {m.customers && (
                  <div style={{ padding: '8px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <div>
                        <div style={{ fontSize: '2rem', fontWeight: 800 }}>{m.customers.total}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>активних клієнтів</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-green)' }}>{m.customers.returning_pct}%</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>повторних</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', height: '8px', borderRadius: '4px', overflow: 'hidden', marginBottom: '12px' }}>
                      <div style={{ flex: m.customers.returning, background: 'var(--accent-green)', borderRadius: '4px' }} />
                      <div style={{ flex: m.customers.new, background: 'var(--accent-blue)', borderRadius: '4px' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                      <span style={{ color: 'var(--accent-green)' }}>🔄 Повторні: {m.customers.returning}</span>
                      <span style={{ color: 'var(--accent-blue)' }}>🆕 Нові: {m.customers.new}</span>
                    </div>
                    <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: '16px' }}
                      onClick={() => router.push('/customers')}>
                      Детальна аналітика →
                    </button>
                  </div>
                )}
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

            {/* Bottom: Top Customers + AI */}
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

      {/* ═══ DRILL-DOWN MODAL ═══ */}
      {drilldown && (
        <DrillDownModal
          title={drilldown.title}
          items={drilldown.items}
          valueFmt={drilldown.valueFmt}
          onClose={() => setDrilldown(null)}
          onDrillDeeper={drilldown.onDrillDeeper}
          router={router}
        />
      )}
    </div>
  );
}
