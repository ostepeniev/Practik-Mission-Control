'use client';
import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import api from '@/lib/api';

export default function AIChatWidget() {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [toolsUsed, setToolsUsed] = useState([]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  const user = typeof window !== 'undefined' ? api.getUser() : null;

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function loadConversations() {
    try {
      const res = await api.getConversations();
      setConversations(res?.conversations || []);
    } catch (e) { console.error(e); }
  }

  async function loadConversation(id) {
    try {
      const res = await api.getConversation(id);
      setMessages(res?.messages?.map(m => ({ role: m.role, content: m.content })) || []);
      setConversationId(id);
      setShowHistory(false);
    } catch (e) { console.error(e); }
  }

  function startNewChat() {
    setMessages([]);
    setConversationId(null);
    setShowHistory(false);
    setToolsUsed([]);
  }

  async function handleSend(e) {
    e?.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);
    setToolsUsed([]);

    try {
      const res = await api.sendAIMessage(userMsg, conversationId);
      if (res.conversation_id) setConversationId(res.conversation_id);
      if (res.tools_used) setToolsUsed(res.tools_used);
      setMessages(prev => [...prev, { role: 'assistant', content: res.content || 'Немає відповіді' }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Помилка: ${err.message || 'Не вдалося отримати відповідь'}`,
      }]);
    }
    setLoading(false);
  }

  async function handleDeleteConversation(id, e) {
    e.stopPropagation();
    try {
      await api.deleteConversation(id);
      if (conversationId === id) startNewChat();
      loadConversations();
    } catch (e) { console.error(e); }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!user || !api.token) return null;

  const panelClass = `ai-chat-panel ${open ? 'open' : ''} ${fullscreen ? 'fullscreen' : ''}`;

  return (
    <>
      {/* Floating Bubble */}
      {!open && (
        <button className="ai-chat-bubble" onClick={() => setOpen(true)} title="AI Асистент">
          <span className="ai-bubble-icon">🤖</span>
          <span className="ai-bubble-pulse" />
        </button>
      )}

      {/* Chat Panel */}
      <div className={panelClass}>
        {/* Header */}
        <div className="ai-chat-header">
          <div className="ai-chat-header-left">
            <span className="ai-chat-avatar">🤖</span>
            <div>
              <div className="ai-chat-title">AI Аналітик</div>
              <div className="ai-chat-subtitle">Practik UA · GPT-4o</div>
            </div>
          </div>
          <div className="ai-chat-header-actions">
            <button className="ai-header-btn" onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadConversations(); }} title="Історія">
              📋
            </button>
            <button className="ai-header-btn" onClick={startNewChat} title="Новий діалог">
              ➕
            </button>
            <button className="ai-header-btn" onClick={() => setFullscreen(!fullscreen)} title={fullscreen ? 'Компактно' : 'На весь екран'}>
              {fullscreen ? '🗗' : '⛶'}
            </button>
            <button className="ai-header-btn ai-close-btn" onClick={() => { setOpen(false); setFullscreen(false); setShowHistory(false); }} title="Закрити">
              ✕
            </button>
          </div>
        </div>

        {/* History Panel */}
        {showHistory && (
          <div className="ai-history-panel">
            <div className="ai-history-title">Попередні діалоги</div>
            {conversations.length === 0 ? (
              <div className="ai-history-empty">Немає збережених діалогів</div>
            ) : (
              conversations.map(c => (
                <div key={c.id} className="ai-history-item" onClick={() => loadConversation(c.id)}>
                  <div className="ai-history-item-title">{c.title}</div>
                  <div className="ai-history-item-date">{c.updated_at?.slice(0, 10)}</div>
                  <button className="ai-history-delete" onClick={(e) => handleDeleteConversation(c.id, e)} title="Видалити">🗑</button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Messages */}
        <div className="ai-chat-messages">
          {messages.length === 0 && !loading && (
            <div className="ai-chat-welcome">
              <div className="ai-welcome-icon">🤖</div>
              <h3>Привіт! Я AI-аналітик Practik UA</h3>
              <p>Запитуйте будь-що про продажі, маржу, товари, скарги та клієнтів.</p>
              <div className="ai-suggestions">
                {[
                  'Яка загальна маржа за останній місяць?',
                  'Покажи проблемні партії',
                  'Топ-5 товарів по виторгу',
                  'Порівняй канали продажів',
                ].map((q, i) => (
                  <button key={i} className="ai-suggestion-chip" onClick={() => { setInput(q); }}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`ai-message ai-message-${m.role}`}>
              {m.role === 'assistant' && <span className="ai-msg-avatar">🤖</span>}
              <div className={`ai-msg-content ${m.role}`}>
                {m.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || ''}</ReactMarkdown>
                ) : (
                  <span>{m.content}</span>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="ai-message ai-message-assistant">
              <span className="ai-msg-avatar">🤖</span>
              <div className="ai-msg-content assistant">
                <div className="ai-typing">
                  <span className="ai-typing-dot" />
                  <span className="ai-typing-dot" />
                  <span className="ai-typing-dot" />
                </div>
              </div>
            </div>
          )}

          {toolsUsed.length > 0 && !loading && (
            <div className="ai-tools-used">
              🔧 Використано: {[...new Set(toolsUsed)].join(', ')}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form className="ai-chat-input-bar" onSubmit={handleSend}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Запитайте щось про бізнес..."
            rows={1}
            disabled={loading}
            className="ai-chat-textarea"
          />
          <button type="submit" disabled={loading || !input.trim()} className="ai-send-btn">
            {loading ? '⏳' : '➤'}
          </button>
        </form>
      </div>

      {/* Backdrop for fullscreen */}
      {open && fullscreen && <div className="ai-chat-backdrop" onClick={() => { setFullscreen(false); }} />}
    </>
  );
}
