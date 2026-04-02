'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [features, setFeatures] = useState([]);
  const [widgets, setWidgets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const u = api.getUser();
    if (!u || u.role !== 'developer') { router.push('/'); return; }
    setUser(u);
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [f, w] = await Promise.all([api.getFeatures(), api.getWidgets()]);
    setFeatures(f?.features || []);
    setWidgets(w?.widgets || []);
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

  if (!user) return null;

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
          </div>
        )}
      </main>
    </div>
  );
}
