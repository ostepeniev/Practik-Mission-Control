'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import NotificationBell from '@/app/components/NotificationBell';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

function fmtNum(v) { return v == null ? '—' : v.toLocaleString('uk-UA'); }
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 14px', fontSize: '0.8rem' }}>
      <div style={{ color: '#94A3B8', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || '#F1F5F9', fontWeight: 600, marginBottom: 2 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: p.color, marginRight: 6 }} />
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </div>
      ))}
    </div>
  );
}

const DAYS_UA = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const HOURS = Array.from({ length: 11 }, (_, i) => i + 8); // 8-18

function sentimentColor(score) {
  if (score >= 8) return '#10B981';
  if (score >= 6) return '#F59E0B';
  if (score >= 4) return '#F97316';
  return '#EF4444';
}

function trendIcon(trend) {
  if (trend === 'improving') return '📈';
  if (trend === 'declining') return '📉';
  return '➡️';
}

export default function HRPage() {
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
      const res = await api.get(`/api/hr?${params}`);
      setData(res);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  // Build heatmap matrix
  function buildHeatmap(raw) {
    const matrix = {};
    let maxConflicts = 1;
    for (const r of (raw || [])) {
      const key = `${r.dow}-${r.hour}`;
      matrix[key] = r.conflicts || 0;
      if (r.conflicts > maxConflicts) maxConflicts = r.conflicts;
    }
    return { matrix, maxConflicts };
  }

  if (!user) return null;

  const { matrix: hm, maxConflicts } = data ? buildHeatmap(data.heatmap) : { matrix: {}, maxConflicts: 1 };

  return (
    <div className="app-layout">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo" onClick={() => navigate('/')}>
            <h1>🐾 Practik UA</h1><span>Analytics Dashboard</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-item" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>📊 Аналітика товарів</div>
          <div className="nav-item" onClick={() => navigate('/marketing')} style={{ cursor: 'pointer' }}>📈 Маркетинг</div>
          <div className="nav-item" onClick={() => navigate('/warehouse')} style={{ cursor: 'pointer' }}>🏭 Склад</div>
          <div className="nav-item" onClick={() => navigate('/finance')} style={{ cursor: 'pointer' }}>💰 Фінанси</div>
          <div className="nav-item active">👥 HR</div>
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
          <div><h2>👥 HR — Команда та комунікація</h2><p>Sentiment-аналіз дзвінків, конфлікти, AI-коуч</p></div>
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
              <div className="kpi-card"><div className="kpi-icon">👤</div><div className="kpi-label">СПІВРОБІТНИКІВ</div><div className="kpi-value">{data.kpi.totalEmployees}</div></div>
              <div className="kpi-card"><div className="kpi-icon">🆕</div><div className="kpi-label">НОВИХ</div><div className="kpi-value">{data.kpi.newThisMonth}</div></div>
              <div className="kpi-card"><div className="kpi-icon">🚪</div><div className="kpi-label">ЗВІЛЬНЕНИХ</div><div className="kpi-value">{data.kpi.firedThisMonth}</div></div>
              <div className="kpi-card"><div className="kpi-icon">😊</div><div className="kpi-label">NPS (ЗАДОВОЛЕНІСТЬ)</div><div className="kpi-value">{data.kpi.avgSatisfaction}/10</div></div>
              <div className="kpi-card"><div className="kpi-icon">⚡</div><div className="kpi-label">КОНФЛІКТІВ</div><div className="kpi-value" style={{color: data.kpi.conflictsCount > 10 ? '#EF4444' : '#F59E0B'}}>{data.kpi.conflictsCount}</div></div>
              <div className="kpi-card"><div className="kpi-icon">🎯</div><div className="kpi-label">СЕР. ТОН</div><div className="kpi-value" style={{color: sentimentColor(data.kpi.avgTone)}}>{data.kpi.avgTone}/10</div></div>
            </div>

            {/* Charts */}
            <div className="charts-grid">
              <div className="card">
                <h3>📈 Динаміка sentiment по команді</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={data.sentimentTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="week_start" tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={v => v?.slice(5)} />
                    <YAxis domain={[0, 10]} tick={{ fill: '#94A3B8', fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Line type="monotone" dataKey="score" name="Sentiment" stroke="#10B981" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="conflicts" name="Конфлікти" stroke="#EF4444" strokeWidth={2} dot={false} yAxisId="right" />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h3>📊 Конфлікти по відділах</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data.conflictsByDept}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="department" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="conflicts" name="Конфлікти" fill="#EF4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Heatmap + Top/Bottom */}
            <div className="charts-grid">
              <div className="card">
                <h3>🗓️ Heatmap: конфлікти (день × година)</h3>
                <div className="heatmap-grid">
                  <div className="heatmap-header"><div className="heatmap-label"></div>{HOURS.map(h => <div key={h} className="heatmap-cell-header">{h}:00</div>)}</div>
                  {[1,2,3,4,5,6,0].map(dow => (
                    <div key={dow} className="heatmap-row">
                      <div className="heatmap-label">{DAYS_UA[dow]}</div>
                      {HOURS.map(h => {
                        const val = hm[`${dow}-${h}`] || 0;
                        const intensity = maxConflicts > 0 ? val / maxConflicts : 0;
                        return (
                          <div key={h} className="heatmap-cell" title={`${DAYS_UA[dow]} ${h}:00 — ${val} конфліктів`}
                            style={{ background: val === 0 ? 'rgba(255,255,255,0.03)' : `rgba(239,68,68,${0.15 + intensity * 0.85})` }}>
                            {val > 0 && <span>{val}</span>}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <h3>🏆 Топ-5 / Найгірші-5 по sentiment</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <h4 style={{ color: '#10B981', marginBottom: 8, fontSize: '0.85rem' }}>🟢 Найкращі</h4>
                    {data.topSentiment?.map((e, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.85rem' }}>
                        <span>{e.name}</span>
                        <span style={{ color: sentimentColor(e.avg_score), fontWeight: 600 }}>{e.avg_score?.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h4 style={{ color: '#EF4444', marginBottom: 8, fontSize: '0.85rem' }}>🔴 Потребують уваги</h4>
                    {data.bottomSentiment?.map((e, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.85rem' }}>
                        <span>{e.name}</span>
                        <span style={{ color: sentimentColor(e.avg_score), fontWeight: 600 }}>{e.avg_score?.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Employee table */}
            <div className="card">
              <h3>👥 Таблиця співробітників</h3>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr><th>Ім'я</th><th>Відділ</th><th>Посада</th><th>Sentiment</th><th>Дзвінків</th><th>Конфліктів</th><th>Тренд</th></tr>
                  </thead>
                  <tbody>
                    {data.employees?.map(e => (
                      <tr key={e.id}>
                        <td style={{ fontWeight: 600 }}>{e.name}</td>
                        <td>{e.department}</td>
                        <td style={{ fontSize: '0.8rem', color: '#94A3B8' }}>{e.position}</td>
                        <td>
                          <div className="sentiment-bar-container">
                            <div className="sentiment-bar" style={{ width: `${(e.avg_sentiment / 10) * 100}%`, background: sentimentColor(e.avg_sentiment) }} />
                            <span className="sentiment-value">{e.avg_sentiment?.toFixed(1)}</span>
                          </div>
                        </td>
                        <td>{e.call_count}</td>
                        <td style={{ color: e.conflict_count > 2 ? '#EF4444' : '#94A3B8' }}>{e.conflict_count}</td>
                        <td>{trendIcon(e.trend)} {e.trend === 'improving' ? 'Краще' : e.trend === 'declining' ? 'Гірше' : 'Стабільно'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* AI Alerts */}
            {data.alerts?.length > 0 && (
              <div className="card">
                <h3>🤖 AI-коуч: Рекомендації</h3>
                <div className="alerts-list">
                  {data.alerts.map((a, i) => (
                    <div key={i} className={`alert-item ${a.type}`}>
                      <div className="alert-icon">{a.type === 'critical' ? '🔴' : '🟡'}</div>
                      <div className="alert-content">
                        <strong>{a.title}</strong>
                        <p>{a.message}</p>
                        {a.date && <small style={{ color: '#64748B' }}>{a.date}</small>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
    </div>
  );
}
