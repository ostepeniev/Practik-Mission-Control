'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [features, setFeatures] = useState([]);
  const [widgets, setWidgets] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Password change state
  const [pwUserId, setPwUserId] = useState(null);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwMsg, setPwMsg] = useState(null); // { type: 'ok'|'err', text }
  const [pwLoading, setPwLoading] = useState(false);

  useEffect(() => {
    const u = api.getUser();
    if (!u || u.role !== 'developer') { router.push('/'); return; }
    setUser(u);
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [f, w, u] = await Promise.all([api.getFeatures(), api.getWidgets(), api.getUsers()]);
    setFeatures(f?.features || []);
    setWidgets(w?.widgets || []);
    setUsers(u?.users || []);
    setLoading(false);
  }

  async function toggleFeature(key, current) {
    await api.toggleFeature(key, !current);
    setFeatures(prev => prev.map(f => f.key === key ? { ...f, is_enabled: !current } : f));
  }

  async function toggleWidget(id, current) {
    await api.toggleWidget(id, !current);
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, is_visible_owner: !current } : w));
  }

  async function handlePasswordChange(e) {
    e.preventDefault();
    setPwMsg(null);

    if (pwNew.length < 4) {
      setPwMsg({ type: 'err', text: 'Пароль має бути мінімум 4 символи' });
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwMsg({ type: 'err', text: 'Паролі не збігаються' });
      return;
    }

    const targetId = pwUserId || user?.id;
    const isSelf = targetId === user?.id;

    if (isSelf && !pwCurrent) {
      setPwMsg({ type: 'err', text: 'Введіть поточний пароль' });
      return;
    }

    setPwLoading(true);
    try {
      const result = await api.changePassword({
        target_user_id: targetId,
        current_password: isSelf ? pwCurrent : undefined,
        new_password: pwNew,
      });
      if (result.success) {
        setPwMsg({ type: 'ok', text: result.message });
        setPwCurrent('');
        setPwNew('');
        setPwConfirm('');
      } else {
        setPwMsg({ type: 'err', text: result.error || 'Помилка' });
      }
    } catch (err) {
      setPwMsg({ type: 'err', text: err.message || 'Помилка зміни пароля' });
    }
    setPwLoading(false);
  }

  if (!user) return null;

  const selectedUser = users.find(u => u.id === (pwUserId || user?.id));
  const isSelf = !pwUserId || pwUserId === user?.id;

  return (
    <div className="app-layout">
      <main className="main-content" style={{ marginLeft: 0 }}>
        <a className="back-link" onClick={() => router.push('/')} style={{ cursor: 'pointer' }}>
          ← Назад до дашборду
        </a>

        <div className="page-header">
          <div>
            <h2>⚙️ Адмін-панель</h2>
            <p>Керування видимістю віджетів та функцій для ролі "Власник"</p>
          </div>
          <span className="dev-badge">🛠 Тільки для розробника</span>
        </div>

        {loading ? (
          <div className="loading-spinner"><div className="spinner" /></div>
        ) : (
          <div className="admin-grid">
            {/* Feature Flags */}
            <div className="card">
              <div className="card-title">🚩 Feature Flags</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                {features.map(f => (
                  <div key={f.key} className="admin-item">
                    <div>
                      <div className="admin-item-label">{f.key}</div>
                      <div className="admin-item-desc">{f.description}</div>
                    </div>
                    <button
                      className={`toggle ${f.is_enabled ? 'active' : ''}`}
                      onClick={() => toggleFeature(f.key, f.is_enabled)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Widget Visibility */}
            <div className="card">
              <div className="card-title">👁 Видимість віджетів для Власника</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                {widgets.map(w => (
                  <div key={w.id} className="admin-item">
                    <div>
                      <div className="admin-item-label">{w.title}</div>
                      <div className="admin-item-desc">{w.widget_type} · {w.size}</div>
                    </div>
                    <button
                      className={`toggle ${w.is_visible_owner ? 'active' : ''}`}
                      onClick={() => toggleWidget(w.id, w.is_visible_owner)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Password Management */}
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <div className="card-title">🔐 Зміна паролів</div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px', marginBottom: '16px' }}>
                {users.map(u => (
                  <button
                    key={u.id}
                    className={`filter-chip ${(pwUserId || user?.id) === u.id ? 'active' : ''}`}
                    onClick={() => { setPwUserId(u.id); setPwMsg(null); setPwCurrent(''); setPwNew(''); setPwConfirm(''); }}
                  >
                    {u.role === 'developer' ? '🛠' : '👤'} {u.display_name}
                  </button>
                ))}
              </div>

              <form onSubmit={handlePasswordChange} style={{ maxWidth: '400px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                  {isSelf ? 'Зміна вашого пароля' : `Зміна пароля для: ${selectedUser?.display_name || '?'}`}
                </div>

                {isSelf && (
                  <div className="form-group" style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Поточний пароль</label>
                    <input
                      type="password"
                      value={pwCurrent}
                      onChange={e => setPwCurrent(e.target.value)}
                      placeholder="Введіть поточний пароль"
                      style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                    />
                  </div>
                )}

                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Новий пароль</label>
                  <input
                    type="password"
                    value={pwNew}
                    onChange={e => setPwNew(e.target.value)}
                    placeholder="Мінімум 4 символи"
                    style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Підтвердження паролю</label>
                  <input
                    type="password"
                    value={pwConfirm}
                    onChange={e => setPwConfirm(e.target.value)}
                    placeholder="Повторіть новий пароль"
                    style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={pwLoading || !pwNew || !pwConfirm}
                >
                  {pwLoading ? '⏳...' : '🔐 Змінити пароль'}
                </button>

                {pwMsg && (
                  <div style={{
                    marginTop: '12px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    background: pwMsg.type === 'ok' ? 'rgba(46,204,113,0.15)' : 'rgba(239,68,68,0.15)',
                    color: pwMsg.type === 'ok' ? '#2ECC71' : '#EF4444',
                    border: `1px solid ${pwMsg.type === 'ok' ? 'rgba(46,204,113,0.3)' : 'rgba(239,68,68,0.3)'}`,
                  }}>
                    {pwMsg.type === 'ok' ? '✅' : '❌'} {pwMsg.text}
                  </div>
                )}
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
