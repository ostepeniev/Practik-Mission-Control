'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import NotificationBell from '@/app/components/NotificationBell';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

// ─── Helpers ────────────────────────────────────────────────
function fmtCurrency(v) {
  if (v == null) return '—';
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M ₴';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K ₴';
  return Math.round(v) + ' ₴';
}
function fmtNum(v) { return v == null ? '—' : v.toLocaleString('uk-UA'); }
function fmtPct(v) { return v == null ? '—' : v.toFixed(1) + '%'; }
function fmtRoas(v) { return v == null ? '—' : v.toFixed(2); }

function DeltaBadge({ value, inverse }) {
  if (value == null || value === 0) return <span className="kpi-delta neutral">— 0%</span>;
  const pos = inverse ? value < 0 : value > 0;
  return (
    <span className={`kpi-delta ${pos ? 'positive' : 'negative'}`}>
      {pos ? '▲' : '▼'} {value > 0 ? '+' : ''}{value.toFixed(1)}%
    </span>
  );
}

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '8px', padding: '10px 14px', fontSize: '0.8rem'
    }}>
      <div style={{ color: '#94A3B8', marginBottom: '4px' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || '#F1F5F9', fontWeight: 600, marginBottom: '2px' }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: p.color, marginRight: 6 }} />
          {p.name}: {formatter ? formatter(p.value) : p.value?.toLocaleString('uk-UA')}
        </div>
      ))}
    </div>
  );
}

// Channel colors
const CHANNEL_COLORS = {
  google_ads: '#4285F4',
  meta_shark: '#1877F2',
  meta_buntar: '#E4405F',
  tiktok_ads: '#00F2EA',
  viber: '#7360F2',
  instagram_bio: '#E4405F',
  google_organic: '#34A853',
};

// ─── Main Page ──────────────────────────────────────────────
export default function MarketingPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [channels, setChannels] = useState(null);
  const [weeks, setWeeks] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('overview'); // overview | channels | site

  useEffect(() => {
    const u = api.getUser();
    if (!u || !api.token) { router.push('/login'); return; }
    setUser(u);
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [ov, ch, wk, al] = await Promise.all([
        api.getMarketingOverview(),
        api.getMarketingChannels(),
        api.getMarketingWeeks(),
        api.getMarketingAlerts(),
      ]);
      setOverview(ov);
      setChannels(ch);
      setWeeks(wk);
      setAlerts(al?.alerts || []);
    } catch (e) {
      console.error('Marketing load error:', e);
    }
    setLoading(false);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api.syncMarketingSheets();
      setSyncResult(result);
      if (result.success) {
        await loadData();
      }
    } catch (e) {
      setSyncResult({ success: false, error: e.message });
    }
    setSyncing(false);
  }

  if (!user) return null;

  function navigate(path) {
    setSidebarOpen(false);
    router.push(path);
  }

  const kpi = overview?.kpi || {};
  const weeklyData = weeks?.weeks || [];
  const channelList = channels?.channels || [];
  const channelTrends = weeks?.channel_trends || {};
  const trendChannels = weeks?.channels || [];

  return (
    <div className="app-layout">
      {/* Mobile Header */}
      <header className="mobile-header">
        <button className={`burger-btn${sidebarOpen ? ' open' : ''}`}
          onClick={() => setSidebarOpen(o => !o)} aria-label="Меню">
          <span className="burger-line" /><span className="burger-line" /><span className="burger-line" />
        </button>
        <span className="mobile-header-logo">🐾 Practik UA</span>
        {user.role === 'developer' && <span className="dev-badge">🛠 Dev</span>}
      </header>

      <div className={`sidebar-overlay${sidebarOpen ? ' visible' : ''}`}
        onClick={() => setSidebarOpen(false)} />

      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <div><h1>🐾 Practik UA</h1><span>Analytics Dashboard</span></div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-item" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>📊 Аналітика товарів</div>
          <div className="nav-item active">📈 Маркетинг</div>
          <div className="nav-item" style={{ opacity: 0.5 }}>🏭 Склад</div>
          <div className="nav-item" style={{ opacity: 0.5 }}>💰 Фінанси</div>
          <div className="nav-item" style={{ opacity: 0.5 }}>👥 HR</div>
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
          <button className="btn btn-secondary btn-sm" onClick={() => { api.logout(); router.push('/login'); }}>Вийти</button>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        <div className="page-header">
          <div>
            <h2>📈 Маркетинг</h2>
            <p>Щотижневі показники рекламних каналів · Тиждень: {overview?.latest_week || '—'}</p>
          </div>
          <div className="header-actions">
            <NotificationBell />
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {overview?.last_sync && (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginRight: '8px' }}>
                  Останній sync: {new Date(overview.last_sync.created_at).toLocaleString('uk-UA')}
                </span>
              )}
              <button className="btn btn-primary btn-sm" onClick={handleSync} disabled={syncing}>
                {syncing ? '⏳ Sync...' : '🔄 Sync з Sheets'}
              </button>
            </div>
          </div>
        </div>

        {syncResult && (
          <div className={`sync-result ${syncResult.success ? 'success' : 'error'}`}>
            {syncResult.success ? `✅ ${syncResult.message}` : `❌ ${syncResult.error}`}
            <button onClick={() => setSyncResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* Tab Switcher */}
        <div className="filters-bar">
          {[
            ['overview', '📊 Огляд'],
            ['channels', '📡 Канали'],
            ['site', '🌐 Сайт'],
          ].map(([key, label]) => (
            <button key={key} className={`filter-chip ${activeTab === key ? 'active' : ''}`}
              onClick={() => setActiveTab(key)}>{label}</button>
          ))}
        </div>

        {loading ? (
          <div className="loading-spinner"><div className="spinner" /></div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <>
                {/* Alerts */}
                {alerts.length > 0 && (
                  <div className="card marketing-alerts-card">
                    <div className="card-title">🚨 Алерти</div>
                    <div className="marketing-alerts-list">
                      {alerts.map((a, i) => (
                        <div key={i} className={`marketing-alert-item ${a.severity}`}>
                          <span className="marketing-alert-icon">{a.icon}</span>
                          <div>
                            <strong>{a.title}</strong>
                            <div className="marketing-alert-msg">{a.message}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* KPI Cards */}
                <div className="kpi-grid marketing-kpi">
                  <div className="kpi-card">
                    <div className="kpi-icon">📊</div>
                    <div className="kpi-label">ROAS тотал</div>
                    <div className="kpi-value">{fmtRoas(kpi.roas?.value)}</div>
                    <DeltaBadge value={kpi.roas?.delta} />
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-icon">💰</div>
                    <div className="kpi-label">Бюджет тотал</div>
                    <div className="kpi-value">{fmtCurrency(kpi.budget?.value)}</div>
                    <DeltaBadge value={kpi.budget?.delta} />
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-icon">💵</div>
                    <div className="kpi-label">Виручка тотал</div>
                    <div className="kpi-value">{fmtCurrency(kpi.revenue?.value)}</div>
                    <DeltaBadge value={kpi.revenue?.delta} />
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-icon">🎯</div>
                    <div className="kpi-label">CAC</div>
                    <div className="kpi-value">{fmtCurrency(kpi.cac?.value)}</div>
                    <DeltaBadge value={kpi.cac?.delta} inverse />
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-icon">🛒</div>
                    <div className="kpi-label">Відправлень</div>
                    <div className="kpi-value">{fmtNum(kpi.shipped_orders?.value)}</div>
                    <DeltaBadge value={kpi.shipped_orders?.delta} />
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-icon">👤</div>
                    <div className="kpi-label">Нових клієнтів</div>
                    <div className="kpi-value">{fmtNum(kpi.new_clients?.value)}</div>
                    <DeltaBadge value={kpi.new_clients?.delta} />
                  </div>
                </div>

                {/* Charts */}
                <div className="charts-grid">
                  {/* ROAS by channel */}
                  <div className="card chart-card">
                    <div className="card-title">📈 ROAS CRM по каналах (тижні)</div>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={weeklyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="week_label" tick={{ fill: '#64748B', fontSize: 11 }} />
                        <YAxis tick={{ fill: '#64748B', fontSize: 11 }} />
                        <Tooltip content={<ChartTooltip formatter={v => v?.toFixed(2)} />} />
                        <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                        {trendChannels.filter(c => channelTrends[c.name]?.some(d => d.roas != null && d.roas > 0)).map(c => (
                          <Line
                            key={c.name}
                            dataKey={c.name}
                            name={`${c.icon} ${c.display_name}`}
                            stroke={CHANNEL_COLORS[c.name] || '#888'}
                            strokeWidth={2}
                            dot={{ r: 3 }}
                            data={channelTrends[c.name]}
                            connectNulls
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                    {/* Note: Recharts multi-series from different sources needs reformatted data */}
                  </div>

                  {/* Total ROAS trend */}
                  <div className="card chart-card">
                    <div className="card-title">📉 ROAS тотал (тренд)</div>
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={weeklyData}>
                        <defs>
                          <linearGradient id="roasGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="week_label" tick={{ fill: '#64748B', fontSize: 11 }} />
                        <YAxis tick={{ fill: '#64748B', fontSize: 11 }} />
                        <Tooltip content={<ChartTooltip formatter={v => v?.toFixed(2)} />} />
                        <Area type="monotone" dataKey="roas" name="ROAS" stroke="#F59E0B" strokeWidth={2.5} fill="url(#roasGrad)" dot={{ r: 4, fill: '#F59E0B' }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Spend vs Revenue */}
                <div className="card chart-card" style={{ marginBottom: '24px' }}>
                  <div className="card-title">💰 Витрати vs Виручка (по тижнях)</div>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={weeklyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="week_label" tick={{ fill: '#64748B', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v} />
                      <Tooltip content={<ChartTooltip formatter={fmtCurrency} />} />
                      <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                      <Bar dataKey="spend" name="💸 Витрати" fill="#EF4444" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="revenue" name="💰 Виручка" fill="#2ECC71" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}

            {activeTab === 'channels' && (
              <div className="card data-table-wrapper">
                <div className="card-title">📡 Канали — тиждень {channels?.latest_week || '—'}</div>
                <div className="table-scroll">
                  <table className="data-table marketing-channels-table">
                    <thead>
                      <tr>
                        <th>Канал</th>
                        <th>Витрати</th>
                        <th>CRM Продажі</th>
                        <th>ROAS кабінет</th>
                        <th>ROAS CRM</th>
                        <th>Замовлень</th>
                        <th>Нових</th>
                        <th>Трафік</th>
                        <th>Конверсія</th>
                      </tr>
                    </thead>
                    <tbody>
                      {channelList.map(ch => (
                        <tr key={ch.id}>
                          <td>
                            <strong>{ch.icon} {ch.display_name}</strong>
                            <br /><span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{ch.platform}</span>
                          </td>
                          <td>
                            {fmtCurrency(ch.ad_spend)}
                            {ch.ad_spend > 0 && <DeltaBadge value={ch.deltas?.ad_spend} />}
                          </td>
                          <td>
                            {fmtCurrency(ch.crm_revenue)}
                            <DeltaBadge value={ch.deltas?.crm_revenue} />
                          </td>
                          <td>{ch.ad_spend > 0 ? fmtRoas(ch.roas_ad) : '—'}</td>
                          <td>
                            <span style={{
                              color: ch.roas_crm < 1 ? '#EF4444' : ch.roas_crm < 3 ? '#F59E0B' : '#2ECC71',
                              fontWeight: 700,
                            }}>
                              {ch.ad_spend > 0 ? fmtRoas(ch.roas_crm) : '—'}
                            </span>
                            {ch.ad_spend > 0 && <DeltaBadge value={ch.deltas?.roas_crm} />}
                          </td>
                          <td>{fmtNum(ch.crm_orders)}</td>
                          <td>
                            {fmtNum(ch.crm_new_clients)}
                            <br /><span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{fmtPct(ch.new_clients_pct)}</span>
                          </td>
                          <td>
                            {fmtNum(ch.traffic)}
                            <DeltaBadge value={ch.deltas?.traffic} />
                          </td>
                          <td>{fmtPct(ch.conversion)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ fontWeight: 700 }}>
                        <td>Тотал</td>
                        <td>{fmtCurrency(channelList.reduce((s, c) => s + (c.ad_spend || 0), 0))}</td>
                        <td>{fmtCurrency(channelList.reduce((s, c) => s + (c.crm_revenue || 0), 0))}</td>
                        <td>—</td>
                        <td>
                          <span style={{
                            color: kpi.roas?.value < 10 ? '#F59E0B' : '#2ECC71',
                            fontWeight: 700,
                          }}>
                            {fmtRoas(kpi.roas?.value)}
                          </span>
                        </td>
                        <td>{fmtNum(channelList.reduce((s, c) => s + (c.crm_orders || 0), 0))}</td>
                        <td>{fmtNum(channelList.reduce((s, c) => s + (c.crm_new_clients || 0), 0))}</td>
                        <td>{fmtNum(channelList.reduce((s, c) => s + (c.traffic || 0), 0))}</td>
                        <td>—</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Per-channel spend chart */}
                <div style={{ marginTop: '24px' }}>
                  <div className="card-title" style={{ marginBottom: '12px' }}>💸 Витрати по каналах</div>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={channelList.filter(c => c.ad_spend > 0)} layout="vertical" margin={{ left: 120 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v} />
                      <YAxis type="category" dataKey="display_name" tick={{ fill: '#94A3B8', fontSize: 11 }} width={120} />
                      <Tooltip content={<ChartTooltip formatter={fmtCurrency} />} />
                      <Bar dataKey="ad_spend" name="Витрати" radius={[0, 4, 4, 0]}>
                        {channelList.filter(c => c.ad_spend > 0).map((c, i) => (
                          <rect key={i} fill={CHANNEL_COLORS[c.name] || '#3B82F6'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {activeTab === 'site' && (
              <div className="card">
                <div className="card-title">🌐 Дані сайту (GA4)</div>
                {overview?.site ? (
                  <div className="kpi-grid marketing-kpi" style={{ padding: '16px' }}>
                    <div className="kpi-card">
                      <div className="kpi-icon">👥</div>
                      <div className="kpi-label">Трафік</div>
                      <div className="kpi-value">{fmtNum(overview.site.total_traffic)}</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-icon">💰</div>
                      <div className="kpi-label">Ціна 1 користувача</div>
                      <div className="kpi-value">{overview.site.cost_per_user?.toFixed(2)} ₴</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-icon">🛒</div>
                      <div className="kpi-label">Кошик → Покупка</div>
                      <div className="kpi-value">{fmtPct(overview.site.cart_to_purchase_rate)}</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-icon">📈</div>
                      <div className="kpi-label">Конверсія трафіку</div>
                      <div className="kpi-value">{fmtPct(overview.site.traffic_conversion_rate)}</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-icon">⏱</div>
                      <div className="kpi-label">Час на сайті</div>
                      <div className="kpi-value">{overview.site.avg_session_duration}с</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-icon">🤝</div>
                      <div className="kpi-label">Частка взаємодій</div>
                      <div className="kpi-value">{fmtPct(overview.site.engagement_rate)}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '24px', color: 'var(--text-muted)', textAlign: 'center' }}>
                    Дані сайту ще не завантажені. Натисніть «Sync з Sheets» для оновлення.
                  </div>
                )}
              </div>
            )}

            {/* CAC & New Clients trend */}
            {activeTab === 'overview' && (
              <div className="charts-grid">
                <div className="card chart-card">
                  <div className="card-title">🎯 CAC (вартість залучення) по тижнях</div>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={weeklyData}>
                      <defs>
                        <linearGradient id="cacGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="week_label" tick={{ fill: '#64748B', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#64748B', fontSize: 11 }} />
                      <Tooltip content={<ChartTooltip formatter={fmtCurrency} />} />
                      <Area type="monotone" dataKey="cac" name="CAC" stroke="#EF4444" strokeWidth={2} fill="url(#cacGrad)" dot={{ r: 3 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="card chart-card">
                  <div className="card-title">👤 Нові клієнти по тижнях</div>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={weeklyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="week_label" tick={{ fill: '#64748B', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#64748B', fontSize: 11 }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="new_clients" name="Нові клієнти" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
