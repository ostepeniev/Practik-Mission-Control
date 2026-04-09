import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { chatCompletion, isGatewayReady } from '@/lib/llm-gateway';

// ─── In-memory cache (15 min) ───────────────────────
let _pulseCache = { text: null, ts: 0, period: null };
const CACHE_TTL = 15 * 60 * 1000;

export async function POST(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { metrics, plan_fact, period } = body;

  if (!metrics) {
    return NextResponse.json({ error: 'metrics required' }, { status: 400 });
  }

  // Check cache
  const cacheKey = `${period?.from}-${period?.to}`;
  if (_pulseCache.text && _pulseCache.period === cacheKey && (Date.now() - _pulseCache.ts) < CACHE_TTL) {
    return NextResponse.json({ summary: _pulseCache.text, cached: true });
  }

  // Check if LLM is available
  if (!isGatewayReady()) {
    // Generate a rule-based summary as fallback
    const summary = generateFallbackSummary(metrics, plan_fact);
    return NextResponse.json({ summary, cached: false, provider: 'rule-based' });
  }

  try {
    const prompt = buildPulsePrompt(metrics, plan_fact, period);

    const result = await chatCompletion({
      messages: [
        { role: 'system', content: 'Ти — аналітик компанії Practik UA (корми для тварин). Генеруй стислий бізнес-дайджест для власника. Пиши українською. Максимум 4 речення. Використовуй emoji на початку кожного речення. Будь конкретним — вказуй цифри та відсотки.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 300,
    });

    const summary = result.message.content;

    // Cache it
    _pulseCache = { text: summary, ts: Date.now(), period: cacheKey };

    return NextResponse.json({ summary, cached: false, provider: result.provider, model: result.model });
  } catch (error) {
    console.error('[AI Pulse] Error:', error.message);
    const summary = generateFallbackSummary(metrics, plan_fact);
    return NextResponse.json({ summary, cached: false, provider: 'rule-based', error: error.message });
  }
}

function buildPulsePrompt(m, pf, period) {
  const lines = [
    `Період: ${period?.from} — ${period?.to}`,
    `Виторг: ${fmt(m.revenue_mtd?.value)} ₴ (${fmtD(m.revenue_mtd?.delta_pct)} vs минулий період)`,
    `Маржа: ${m.gross_margin_pct?.value}% (${fmtD(m.gross_margin_pct?.delta_pct)} п.п.)`,
    `Замовлень: ${m.order_count?.value} (${fmtD(m.order_count?.delta_pct)})`,
    `Середній чек: ${fmt(m.avg_check?.value)} ₴ (${fmtD(m.avg_check?.delta_pct)})`,
    `Повернення: ${m.returns_pct?.value}%`,
  ];
  if (m.customers) {
    lines.push(`Клієнти: ${m.customers.total} (нових: ${m.customers.new}, повторних: ${m.customers.returning})`);
  }
  if (pf) {
    lines.push(`План виторгу: ${pf.revenue?.pct}% виконано`);
    lines.push(`План замовлень: ${pf.orders?.pct}% виконано`);
  }
  lines.push('', 'Згенеруй 3-4 речення — стислий дайджест для CEO. Вкажи головне: позитив, ризик, рекомендацію.');
  return lines.join('\n');
}

function generateFallbackSummary(m, pf) {
  const parts = [];
  const revD = m.revenue_mtd?.delta_pct || 0;
  const margD = m.gross_margin_pct?.delta_pct || 0;

  if (revD > 5) parts.push(`📈 Виторг зріс на ${revD.toFixed(1)}% порівняно з минулим періодом — позитивна динаміка.`);
  else if (revD < -5) parts.push(`📉 Виторг знизився на ${Math.abs(revD).toFixed(1)}% — потребує уваги.`);
  else parts.push(`📊 Виторг стабільний (${revD > 0 ? '+' : ''}${revD.toFixed(1)}% vs минулий період).`);

  if (margD < -2) parts.push(`⚠️ Маржинальність просіла на ${Math.abs(margD).toFixed(1)} п.п. — перевірте знижки та собівартість.`);
  else if (margD > 2) parts.push(`✅ Маржинальність покращилась на ${margD.toFixed(1)} п.п.`);

  if (pf?.revenue?.pct) {
    const p = pf.revenue.pct;
    if (p >= 100) parts.push(`🎯 План по виторгу виконано на ${p.toFixed(0)}% — відмінний результат!`);
    else if (p >= 80) parts.push(`🎯 План по виторгу виконано на ${p.toFixed(0)}% — в рамках норми.`);
    else parts.push(`🎯 План по виторгу виконано лише на ${p.toFixed(0)}% — є ризик невиконання.`);
  }

  if (m.customers?.returning_pct > 70) parts.push(`👥 ${m.customers.returning_pct}% клієнтів — повторні, що свідчить про високу лояльність.`);

  return parts.slice(0, 4).join('\n');
}

function fmt(v) { return v != null ? Math.round(v).toLocaleString('uk-UA') : '—'; }
function fmtD(v) { return v != null ? (v > 0 ? '+' : '') + v.toFixed(1) + '%' : '—'; }
