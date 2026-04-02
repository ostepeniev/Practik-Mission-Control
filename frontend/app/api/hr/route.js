import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
    const dateTo = searchParams.get('date_to') || new Date().toISOString().slice(0,10);

    // KPI
    const totalEmp = db.prepare(`SELECT COUNT(*) as cnt FROM employees WHERE status='active'`).get();
    const newEmp = db.prepare(`SELECT COUNT(*) as cnt FROM employees WHERE hire_date BETWEEN ? AND ?`).get(dateFrom, dateTo);
    const firedEmp = db.prepare(`SELECT COUNT(*) as cnt FROM employees WHERE status='fired'`).get();
    const avgSat = db.prepare(`SELECT AVG(satisfaction_score) as avg FROM employees WHERE status='active'`).get();
    const conflicts = db.prepare(`SELECT COUNT(*) as cnt FROM employee_conflict_events WHERE conflict_date BETWEEN ? AND ?`).get(dateFrom, dateTo);
    const avgTone = db.prepare(`SELECT AVG(s.score) as avg FROM call_sentiment_scores s JOIN employee_calls c ON c.id = s.call_id WHERE c.call_date BETWEEN ? AND ?`).get(dateFrom, dateTo);

    const kpi = {
      totalEmployees: totalEmp?.cnt || 0,
      newThisMonth: newEmp?.cnt || 0,
      firedThisMonth: firedEmp?.cnt || 0,
      avgSatisfaction: Math.round((avgSat?.avg || 0) * 10) / 10,
      conflictsCount: conflicts?.cnt || 0,
      avgTone: Math.round((avgTone?.avg || 0) * 10) / 10,
    };

    // Employee list with sentiment
    const employees = db.prepare(`
      SELECT e.id, e.name, e.department, e.position, e.hire_date, e.status, e.satisfaction_score,
        COALESCE(cs.avg_score, 0) as avg_sentiment,
        COALESCE(cs.call_count, 0) as call_count,
        COALESCE(cs.conflict_count, 0) as conflict_count,
        COALESCE(cs.trend, 'stable') as trend
      FROM employees e
      LEFT JOIN (
        SELECT employee_id, avg_score, call_count, conflict_count, trend
        FROM employee_sentiment_weekly
        WHERE week_start = (SELECT MAX(week_start) FROM employee_sentiment_weekly)
      ) cs ON cs.employee_id = e.id
      WHERE e.status = 'active'
      ORDER BY e.department, e.name
    `).all();

    // Sentiment trend (weekly)
    const sentimentTrend = db.prepare(`
      SELECT week_start, AVG(avg_score) as score, SUM(conflict_count) as conflicts, SUM(call_count) as calls
      FROM employee_sentiment_weekly
      GROUP BY week_start ORDER BY week_start
    `).all();

    // Conflicts by department
    const conflictsByDept = db.prepare(`
      SELECT e.department, COUNT(*) as conflicts
      FROM employee_conflict_events ec
      JOIN employees e ON e.id = ec.employee_id
      WHERE ec.conflict_date BETWEEN ? AND ?
      GROUP BY e.department ORDER BY conflicts DESC
    `).all(dateFrom, dateTo);

    // Top/bottom 5 by sentiment
    const topSentiment = db.prepare(`
      SELECT e.name, e.department, AVG(s.score) as avg_score, COUNT(*) as calls
      FROM employees e
      JOIN employee_calls c ON c.employee_id = e.id
      JOIN call_sentiment_scores s ON s.call_id = c.id
      WHERE c.call_date BETWEEN ? AND ? AND e.status = 'active'
      GROUP BY e.id ORDER BY avg_score DESC LIMIT 5
    `).all(dateFrom, dateTo);

    const bottomSentiment = db.prepare(`
      SELECT e.name, e.department, AVG(s.score) as avg_score, COUNT(*) as calls
      FROM employees e
      JOIN employee_calls c ON c.employee_id = e.id
      JOIN call_sentiment_scores s ON s.call_id = c.id
      WHERE c.call_date BETWEEN ? AND ? AND e.status = 'active'
      GROUP BY e.id ORDER BY avg_score ASC LIMIT 5
    `).all(dateFrom, dateTo);

    // Heatmap: day of week × hour
    const heatmapRaw = db.prepare(`
      SELECT 
        CAST(strftime('%w', c.call_date) AS INTEGER) as dow,
        CAST(substr(c.call_time, 1, 2) AS INTEGER) as hour,
        COUNT(*) as total,
        SUM(s.has_conflict) as conflicts
      FROM employee_calls c
      JOIN call_sentiment_scores s ON s.call_id = c.id
      WHERE c.call_date BETWEEN ? AND ?
      GROUP BY dow, hour
    `).all(dateFrom, dateTo);

    // AI alerts
    const alerts = [];
    // Recent conflicts
    const recentConflicts = db.prepare(`
      SELECT ec.description, ec.severity, ec.conflict_date, e.name as employee_name,
        s.ai_summary
      FROM employee_conflict_events ec
      JOIN employees e ON e.id = ec.employee_id
      LEFT JOIN call_sentiment_scores s ON s.call_id = ec.call_id
      WHERE ec.conflict_date BETWEEN ? AND ?
      ORDER BY ec.conflict_date DESC LIMIT 5
    `).all(dateFrom, dateTo);
    for (const c of recentConflicts) {
      alerts.push({
        type: c.severity,
        title: `Конфлікт: ${c.employee_name}`,
        message: c.description,
        date: c.conflict_date,
      });
    }
    // Declining employees
    const declining = db.prepare(`
      SELECT e.name, sw.avg_score, sw.trend
      FROM employee_sentiment_weekly sw
      JOIN employees e ON e.id = sw.employee_id
      WHERE sw.week_start = (SELECT MAX(week_start) FROM employee_sentiment_weekly)
        AND sw.trend = 'declining' AND e.status = 'active'
    `).all();
    for (const d of declining) {
      alerts.push({
        type: 'warning',
        title: `Тренд погіршення: ${d.name}`,
        message: `Середній тон ${d.avg_score}/10 — рекомендуємо поговорити`,
      });
    }

    return NextResponse.json({
      kpi,
      employees,
      sentimentTrend,
      conflictsByDept,
      topSentiment,
      bottomSentiment,
      heatmap: heatmapRaw,
      alerts,
    });
  } catch (error) {
    console.error('HR API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
