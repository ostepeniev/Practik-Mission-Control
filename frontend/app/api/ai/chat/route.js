import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { chat } from '@/lib/ai-engine';

export async function POST(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { message, conversation_id, page_context } = await req.json();
  if (!message) return NextResponse.json({ detail: 'message is required' }, { status: 400 });

  const db = getDb();

  // Get or create conversation
  let convId = conversation_id;
  if (!convId) {
    const result = db.prepare(
      'INSERT INTO ai_conversations (user_id, title) VALUES (?, ?)'
    ).run(user.id, message.slice(0, 50));
    convId = result.lastInsertRowid;
  }

  // Save user message
  db.prepare(
    'INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)'
  ).run(convId, 'user', message);

  // Load conversation history
  const history = db.prepare(
    'SELECT role, content, tool_calls, tool_call_id FROM ai_messages WHERE conversation_id = ? ORDER BY id'
  ).all(convId);

  try {
    const result = await chat(history, convId, user.sub, page_context);

    // Auto-generate title from first message
    if (!conversation_id) {
      const title = message.length > 50 ? message.slice(0, 47) + '...' : message;
      db.prepare('UPDATE ai_conversations SET title = ? WHERE id = ?').run(title, convId);
    }

    return NextResponse.json({
      conversation_id: convId,
      content: result.content,
      tools_used: result.tools_used,
      usage: result.usage,
      provider: result.provider,
      model: result.model,
    });
  } catch (err) {
    console.error('AI Chat error:', err);

    const errorMsg = err.message?.includes('API key')
      ? 'API ключ не налаштований або невалідний.'
      : `Помилка AI: ${err.message}`;

    return NextResponse.json({
      conversation_id: convId,
      content: errorMsg,
      tools_used: [],
      error: true,
    }, { status: 500 });
  }
}
