import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') || '10');
  const db = getDb();

  const insights = db.prepare(`
    SELECT * FROM ai_insights WHERE is_active = 1 ORDER BY created_at DESC LIMIT ?
  `).all(limit);

  return NextResponse.json({
    insights: insights.map(i => ({
      id: i.id, type: i.insight_type, severity: i.severity,
      title: i.title, body: i.body, product_id: i.related_product_id,
      metric: i.related_metric, confidence: i.confidence,
      is_read: !!i.is_read, created_at: i.created_at
    })),
    total: insights.length
  });
}

export async function POST(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { question, product_id, context } = await req.json();

  // Mock AI response
  let answer, confidence;
  const q = question.toLowerCase();

  if (q.includes('маржа') || q.includes('margin')) {
    answer = 'Аналіз показує, що зниження маржинальності пов\'язане з двома факторами: 1) Збільшення середньої знижки на 4.2 п.п. за останній тиждень, переважно через менеджера Ткаченко М. 2) Зростання собівартості сировини на 3% по категорії сухого корму. Рекомендую: перевірити політику знижок та переглянути закупівельні ціни.';
    confidence = 0.82;
  } else if (q.includes('продаж') || q.includes('виторг') || q.includes('revenue')) {
    answer = 'Продажі за поточний місяць демонструють стабільне зростання +8% порівняно з аналогічним періодом. Найбільший внесок — категорія сухого корму для собак (+12%). Канал маркетплейсів показує найшвидше зростання. Зверніть увагу на товари-новинки: Grain Free Качка має повільний старт.';
    confidence = 0.88;
  } else if (q.includes('знижк') || q.includes('discount')) {
    answer = 'Середня знижка за останній місяць: 8.3%. Менеджер Ткаченко М. застосовує знижки в 2.3 рази частіше за середнє (14.2% проти 6.8%). Зафіксовано 3 замовлення зі знижкою 100% без вказаного promo_type — можливо, помилки оформлення. Рекомендую провести review.';
    confidence = 0.85;
  } else if (q.includes('клієнт') || q.includes('customer')) {
    answer = 'Топ-клієнт за виторгом — ТОВ ЗооМаркет (Київ). Канал маркетплейсів (Розетка, Prom.ua) обігнав оптові продажі на 8%, при цьому маржинальність вища на 3 п.п. Рекомендація: посилити роботу з маркетплейсами.';
    confidence = 0.79;
  } else {
    answer = 'На основі аналізу даних, ситуація загалом стабільна. Ключові метрики в межах норми. Є кілька товарів, що потребують уваги — вони позначені відповідним статусом у таблиці. Запитайте конкретніше для детальнішого аналізу.';
    confidence = 0.7;
  }

  return NextResponse.json({
    response: {
      answer, confidence,
      data_sources: ['sales_orders', 'products', 'managers'],
      follow_up_questions: [
        'Які товари мали найбільші знижки?',
        'Як змінилася динаміка за тиждень?',
        'Порівняй канали продажів'
      ]
    },
    provider: 'mock', latency_ms: 150
  });
}
