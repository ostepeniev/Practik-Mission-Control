'use client';
import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import api from '@/lib/api';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

function fmtCurrency(v) {
  if (v == null) return '—';
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M ₴';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K ₴';
  return v.toFixed(0) + ' ₴';
}
function fmtPct(v) { return v == null ? '—' : v.toFixed(1) + '%'; }
function fmtDelta(d, inverse) {
  if (d == null || d === 0) return { text: '0%', cls: 'neutral' };
  const pos = inverse ? d < 0 : d > 0;
  return { text: (d > 0 ? '+' : '') + d.toFixed(1) + '%', cls: pos ? 'positive' : 'negative' };
}

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

function StatusBadge({ status }) {
  const labels = { normal: 'Норма', attention: 'Увага', risk: 'Ризик', critical: 'Критично', new: 'Новий' };
  return <span className={`status-badge ${status}`}>{labels[status] || status}</span>;
}

const BAR_COLORS = ['#2ECC71', '#3498DB', '#F39C12', '#E74C3C', '#9B59B6', '#1ABC9C'];

export default function ProductDetailPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    if (!api.token) { router.push('/login'); return; }
    loadProduct();
  }, [productId, days]);

  async function loadProduct() {
    setLoading(true);
    try {
      const d = await api.getProductDetail(productId, days);
      setData(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  if (loading) return (
    <div className="app-layout">
      <main className="main-content" style={{ marginLeft: 0 }}>
        <div className="loading-spinner"><div className="spinner" /></div>
      </main>
    </div>
  );

  if (!data || data.error) return (
    <div className="app-layout">
      <main className="main-content" style={{ marginLeft: 0 }}>
        <a className="back-link" onClick={() => router.push('/')} style={{ cursor: 'pointer' }}>← Назад до дашборду</a>
        <h2>Товар не знайдено</h2>
      </main>
    </div>
  );

  const p = data.product;
  const k = data.kpis || {};

  const tabs = [
    { id: 'overview', label: '📊 Огляд' },
    { id: 'managers', label: '👥 Менеджери' },
    { id: 'discounts', label: '💰 Знижки' },
    { id: 'returns', label: '↩️ Повернення' },
    { id: 'complaints', label: '📢 Скарги' },
    { id: 'orders', label: '📋 Замовлення' },
  ];

  return (
    <div className="app-layout">
      <main className="main-content" style={{ marginLeft: 0 }}>
        <a className="back-link" onClick={() => router.push('/')} style={{ cursor: 'pointer' }}>← Назад до дашборду</a>

        {/* Product Header */}
        <div className="product-header">
          <div>
            <h2>{p.name}</h2>
            <div className="product-meta">
              <span className="product-meta-item">SKU: {p.sku}</span>
              <span className="product-meta-item">Категорія: {p.category}</span>
              <StatusBadge status={p.status} />
              {p.launch_date && <span className="product-meta-item">Запуск: {p.launch_date}</span>}
            </div>
          </div>
          <div className="filters-bar" style={{ margin: 0 }}>
            {[7, 14, 30, 60, 90].map(d => (
              <button key={d} className={`filter-chip ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>
                {d} днів
              </button>
            ))}
          </div>
        </div>

        {/* KPIs — expanded */}
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          {[
            { label: 'Виторг', val: fmtCurrency(k.revenue_mtd?.value), delta: k.revenue_mtd?.delta_pct },
            { label: 'Маржа %', val: fmtPct(k.gross_margin_pct?.value), delta: k.gross_margin_pct?.delta_pct },
            { label: 'Обсяг', val: (k.sales_volume?.value?.toFixed(0) || '—') + ' кг', delta: k.sales_volume?.delta_pct },
            { label: 'Замовлень', val: k.order_count?.value || '—', delta: k.order_count?.delta_pct },
            { label: 'Сер. знижка', val: fmtPct(k.avg_discount?.value) },
            { label: 'Промо частка', val: fmtPct(k.promo_share?.value) },
          ].map((item, i) => {
            const d = item.delta != null ? fmtDelta(item.delta, false) : null;
            return (
              <div key={i} className="kpi-card">
                <div className="kpi-label">{item.label}</div>
                <div className="kpi-value" style={{ fontSize: '1.4rem' }}>{item.val}</div>
                {d && <span className={`kpi-delta ${d.cls}`}>{d.text}</span>}
              </div>
            );
          })}
        </div>

        {/* Tab Navigation */}
        <div className="filters-bar" style={{ marginBottom: '16px' }}>
          {tabs.map(tab => (
            <button key={tab.id} className={`filter-chip ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}>
              {tab.label}
              {tab.id === 'returns' && data.returns_summary?.return_count > 0 && (
                <span style={{ marginLeft: '4px', fontSize: '0.7rem', opacity: 0.7 }}>
                  ({data.returns_summary.return_count})
                </span>
              )}
              {tab.id === 'complaints' && data.complaints?.length > 0 && (
                <span style={{ marginLeft: '4px', fontSize: '0.7rem', opacity: 0.7 }}>
                  ({data.complaints.length})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* TAB: Overview */}
        {activeTab === 'overview' && (
          <>
            <div className="detail-grid" style={{ marginBottom: '24px' }}>
              <div className="card">
                <div className="card-title">💰 Ціни</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.85rem' }}>
                  <div><span style={{ color: 'var(--text-muted)' }}>Собівартість:</span> {fmtCurrency(p.current_cost_price)}</div>
                  <div><span style={{ color: 'var(--text-muted)' }}>Рек. ціна:</span> {fmtCurrency(p.recommended_sale_price)}</div>
                  <div><span style={{ color: 'var(--text-muted)' }}>Цільова маржа:</span> {fmtPct(p.target_margin_pct)}</div>
                  <div><span style={{ color: 'var(--text-muted)' }}>Факт. маржа:</span> {fmtPct(k.gross_margin_pct?.value)}</div>
                </div>
              </div>
              <div className="card">
                <div className="card-title">📊 Порівняння з попереднім періодом</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.85rem' }}>
                  <div><span style={{ color: 'var(--text-muted)' }}>Δ Виторг:</span> {k.revenue_mtd?.delta_pct?.toFixed(1)}%</div>
                  <div><span style={{ color: 'var(--text-muted)' }}>Δ Маржа:</span> {k.gross_margin_pct?.delta_pct?.toFixed(1)} п.п.</div>
                  <div><span style={{ color: 'var(--text-muted)' }}>Повернення:</span> {data.returns_summary?.return_rate_pct}%</div>
                  <div><span style={{ color: 'var(--text-muted)' }}>Скарог:</span> {data.complaints?.length || 0}</div>
                </div>
              </div>
            </div>

            <div className="charts-grid">
              <div className="card chart-card">
                <div className="card-title">📈 Виторг по днях</div>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={data.revenue_daily}>
                    <defs>
                      <linearGradient id="greenGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2ECC71" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#2ECC71" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={d => d?.slice(5)} />
                    <YAxis tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v} />
                    <Tooltip content={<ChartTooltip format="currency" />} />
                    <Area type="monotone" dataKey="value" stroke="#2ECC71" strokeWidth={2} fill="url(#greenGrad2)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="card chart-card">
                <div className="card-title">📊 Маржинальність</div>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={data.margin_daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={d => d?.slice(5)} />
                    <YAxis tick={{ fill: '#64748B', fontSize: 11 }} domain={['auto', 'auto']} tickFormatter={v => v + '%'} />
                    <Tooltip content={<ChartTooltip format="percent" />} />
                    <Line type="monotone" dataKey="value" stroke="#3498DB" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}

        {/* TAB: Managers */}
        {activeTab === 'managers' && (
          <div className="card data-table-wrapper">
            <div className="card-title">👥 Продажі по менеджерах</div>
            {data.manager_breakdown?.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={Math.max(200, data.manager_breakdown.length * 50)}>
                  <BarChart data={data.manager_breakdown} layout="vertical" margin={{ left: 120 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#94A3B8', fontSize: 12 }} width={120} />
                    <Tooltip content={<ChartTooltip format="currency" />} />
                    <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                      {data.manager_breakdown.map((_, i) => (
                        <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="table-scroll" style={{ marginTop: '16px' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Менеджер</th><th>Виторг</th><th>К-ть</th><th>Замовлень</th><th>Маржа %</th><th>Сер. знижка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.manager_breakdown.map((m, i) => (
                        <tr key={i}>
                          <td><strong>{m.name}</strong></td>
                          <td>{fmtCurrency(m.revenue)}</td>
                          <td>{m.quantity}</td>
                          <td>{m.orders}</td>
                          <td>{fmtPct(m.margin_pct)}</td>
                          <td>{fmtPct(m.avg_discount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)', padding: '24px', textAlign: 'center' }}>
                Немає даних по менеджерах за цей період
              </div>
            )}
          </div>
        )}

        {/* TAB: Discounts */}
        {activeTab === 'discounts' && (
          <div className="card">
            <div className="card-title">💰 Розподіл знижок</div>
            {data.discount_distribution?.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.discount_distribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="bucket" tick={{ fill: '#94A3B8', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#64748B', fontSize: 11 }} />
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div style={{ background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px 12px', fontSize: '0.8rem' }}>
                        <div style={{ color: '#94A3B8' }}>Знижка: {label}</div>
                        <div style={{ color: '#F1F5F9', fontWeight: 700 }}>{payload[0].value} позицій</div>
                        <div style={{ color: '#94A3B8', fontSize: '0.75rem' }}>Виторг: {fmtCurrency(payload[0].payload.revenue)}</div>
                      </div>
                    );
                  }} />
                  <Bar dataKey="count" fill="#F39C12" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ color: 'var(--text-muted)', padding: '24px', textAlign: 'center' }}>
                Немає даних про знижки
              </div>
            )}
          </div>
        )}

        {/* TAB: Returns */}
        {activeTab === 'returns' && (
          <div className="card data-table-wrapper">
            <div className="card-title">
              ↩️ Повернення
              {data.returns_summary && (
                <span style={{ marginLeft: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Всього: {data.returns_summary.total_returned} шт · 
                  Rate: {data.returns_summary.return_rate_pct}%
                </span>
              )}
            </div>
            {data.returns_recent?.length > 0 ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Дата</th><th>Замовлення</th><th>К-ть</th><th>Тип</th><th>Причина</th><th>Сума</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.returns_recent.map((r, i) => (
                      <tr key={i}>
                        <td>{r.date}</td>
                        <td>{r.order_number}</td>
                        <td>{r.quantity}</td>
                        <td><span className={`status-badge ${r.type === 'refund' ? 'risk' : 'attention'}`}>{r.type}</span></td>
                        <td style={{ maxWidth: '200px', whiteSpace: 'normal' }}>{r.reason}</td>
                        <td>{fmtCurrency(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', padding: '24px', textAlign: 'center' }}>
                ✅ Немає повернень за цей період
              </div>
            )}
          </div>
        )}

        {/* TAB: Complaints */}
        {activeTab === 'complaints' && (
          <div className="card data-table-wrapper">
            <div className="card-title">📢 Скарги по товару</div>
            {data.complaints?.length > 0 ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Дата</th><th>Тип</th><th>Важливість</th><th>Опис</th><th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.complaints.map(c => (
                      <tr key={c.id} onClick={() => router.push('/complaints')} style={{ cursor: 'pointer' }}>
                        <td>{c.date}</td>
                        <td>{c.type}</td>
                        <td><StatusBadge status={c.severity} /></td>
                        <td style={{ maxWidth: '300px', whiteSpace: 'normal' }}>{c.description}</td>
                        <td><span className={`status-badge ${c.status === 'resolved' ? 'normal' : 'attention'}`}>{c.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', padding: '24px', textAlign: 'center' }}>
                ✅ Немає скарг за цей період
              </div>
            )}
          </div>
        )}

        {/* TAB: Orders */}
        {activeTab === 'orders' && (
          <div className="card data-table-wrapper">
            <div className="card-title">📋 Останні замовлення</div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Замовлення</th><th>Дата</th><th>Клієнт</th><th>Менеджер</th>
                    <th>К-ть</th><th>Ціна</th><th>Знижка</th><th>Сума</th><th>Промо</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.recent_orders || []).map((o, i) => (
                    <tr key={i}>
                      <td><strong>{o.order_number}</strong></td>
                      <td>{o.date}</td>
                      <td>{o.customer || '—'}</td>
                      <td>{o.manager || '—'}</td>
                      <td>{o.quantity}</td>
                      <td>{fmtCurrency(o.unit_price)}</td>
                      <td>{o.discount_pct > 0 ? fmtPct(o.discount_pct) : '—'}</td>
                      <td>{fmtCurrency(o.final_price)}</td>
                      <td>{o.is_promo ? <span className="status-badge attention">{o.promo_type}</span> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
