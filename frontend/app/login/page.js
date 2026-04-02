'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.login(username, password);
      if (data.token) {
        router.push('/');
      } else {
        setError(data.detail || 'Помилка входу');
      }
    } catch (err) {
      setError('Невірний логін або пароль');
    }
    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>🐾 Practik UA</h1>
        <p>Аналітична платформа</p>
        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label>Логін</label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Введіть логін"
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label>Пароль</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введіть пароль"
              autoComplete="current-password"
            />
          </div>
          <button id="login-submit" type="submit" className="btn btn-primary login-btn" disabled={loading}>
            {loading ? 'Вхід...' : 'Увійти'}
          </button>
          {error && <div className="login-error">{error}</div>}
        </form>
        <div style={{ marginTop: '24px', fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', opacity: 0.5 }}>
          © {new Date().getFullYear()} Practik UA
        </div>
      </div>
    </div>
  );
}
