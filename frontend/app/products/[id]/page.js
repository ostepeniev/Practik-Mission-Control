'use client';
import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import api from '@/lib/api';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

function fmtCurrency(v) {
  if (v == null) return '—';
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M ₴';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K ₴';
  return v.toFixed(0) + ' ₴';
}
function fmtPct(v) { return v == null ? '—' : v.toFixed(1) + '%'; }

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

export default function ProductDetailPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiResponse, setAiResponse] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [days, setDays] = useState(30);

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

  async function handleAskAI(e) {
    e.preventDefault();
    if (!aiQuestion.trim()) return;
    setAiLoading(true);
    setAiResponse(null);
    try {
      const ctx = data ? `Товар: ${data.product.name} (${data.product.sku}). Маржа: ${data.kpis?.gross_margin_pct?.value}%. Виторг: ${data.kpis?.revenue_mtd?.value} ₴.` : '';
      const res = await api.askAI(aiQuestion, parseInt(productId), ctx);
      setAiResponse(res);
    } catch (e) {
      setAiResponse({ response: { answer: 'Помилка з\'єднання з AI' } });
    }
    setAiLoading(false);
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
        <a className="back-link" onClick={() => router.push('/')} style={{ cursor: 'pointer' }}>
          ← Назад до дашборду
        </a>
        <h2>Товар не знайдено</h2>
      </main>
    </div>
  );

  const p = data.product;
  const k = data.kpis || {};

  return (
    <div className="app-layout">
      <main className="main-content" style={{ marginLeft: 0 }}>
        <a className="back-link" onClick={() => router.push('/')} style={{ cursor: 'pointer' }}>
          ← Назад до дашборду
        </a>

        {/* Product Header */}
        <div className="product-header">
          <div>
            <h2>{p.name}</h2>
            <div className="product-meta">
              <span className="product-meta-item">SKU: {p.sku}</span>
              <span className="product-meta-item">Категорія: {p.category}</span>
              <StatusBadge status={p.status} />
              {p.launch_date && (
                <span className="product-meta-item">Запуск: {p.launch_date}</span>
              )}
            </div>
          </div>
          <div className="filters-bar" style={{ margin: 0 }}>
            {[7, 14, 30, 60, 90].map(d => (
              <button key={d} className={`filter-chip ${days === d ? 'active' : ''}`}
                      onClick={() => setDays(d)}>
                {d} днів
              </button>
            ))}
          </div>
        </div>

        {/* KPIs */}
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="kpi-card">
            <div className="kpi-label">Виторг</div>
            <div className="kpi-value">{fmtCurrency(k.revenue_mtd?.value)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Маржа %</div>
            <div className="kpi-value">{fmtPct(k.gross_margin_pct?.value)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Обсяг</div>
            <div className="kpi-value">{k.sales_volume?.value?.toFixed(0) || '—'} кг</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Замовлень</div>
            <div className="kpi-value">{k.order_count?.value || '—'}</div>
          </div>
        </div>

        {/* Product info cards */}
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
            <div className="card-title">📊 Порівняння</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.85rem' }}>
              <div><span style={{ color: 'var(--text-muted)' }}>Δ Виторг:</span> {k.revenue_mtd?.delta_pct?.toFixed(1)}%</div>
              <div><span style={{ color: 'var(--text-muted)' }}>Δ Маржа:</span> {k.gross_margin_pct?.delta_pct?.toFixed(1)} п.п.</div>
              <div><span style={{ color: 'var(--text-muted)' }}>Попер. виторг:</span> {fmtCurrency(k.revenue_mtd?.prev_value)}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>Попер. маржа:</span> {fmtPct(k.gross_margin_pct?.prev_value)}</div>
            </div>
          </div>
        </div>

        {/* Charts */}
        <div className="charts-grid">
          <div className="card chart-card">
            <div className="card-title">📈 Виторг по днях</div>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.revenue_daily}>
                <defs>
                  <linearGradient id="greenGrad2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2ECC71" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#2ECC71" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={d => d?.slice(5)} />
                <YAxis tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => v >= 1000 ? (v/1000).toFixed(0)+'K' : v} />
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
                <YAxis tick={{ fill: '#64748B', fontSize: 11 }} domain={['auto', 'auto']} tickFormatter={v => v+'%'} />
                <Tooltip content={<ChartTooltip format="percent" />} />
                <Line type="monotone" dataKey="value" stroke="#3498DB" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Orders */}
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

        {/* AI Chat */}
        <div className="card ai-panel">
          <div className="card-title">🤖 Запитайте AI про цей товар</div>
          <form onSubmit={handleAskAI} className="ai-chat-input">
            <input
              value={aiQuestion}
              onChange={e => setAiQuestion(e.target.value)}
              placeholder={`Напр: "чому впала маржа по ${p.name}?"`}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={aiLoading}>
              {aiLoading ? '⏳' : '🚀'}
            </button>
          </form>
          {aiResponse && (
            <div className="ai-response">
              <div className="ai-response-label">🤖 AI відповідь</div>
              <div className="ai-response-text">
                {aiResponse.response?.answer || JSON.stringify(aiResponse.response)}
              </div>
              {aiResponse.response?.confidence && (
                <div className="ai-confidence">Впевненість: {(aiResponse.response.confidence * 100).toFixed(0)}%</div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
