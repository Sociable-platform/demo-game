import { useState } from 'react';
import { api } from '../api.js';
import { CropIcon, Logo } from './Icons.jsx';

export default function AuthScreen({ devMode, onAuthed, notify }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [demo, setDemo] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = mode === 'login' ? await api.login(username, password) : await api.register(username, password);
      onAuthed(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loginAs = async (acct) => {
    setError('');
    setLoading(true);
    try {
      onAuthed((await api.login(acct.username, acct.password)).user);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const createDemo = async (reset) => {
    try {
      const res = await api.devDemoAccounts(reset);
      setDemo(res.accounts);
      notify('success', reset ? 'Demo accounts reset with fresh farms.' : 'Demo accounts are ready.');
    } catch (err) {
      notify('error', err.message);
    }
  };

  return (
    <main className="auth-wrap">
      <section className="card auth-card" aria-labelledby="auth-title">
        <div className="auth-hero">
          <Logo size={56} />
          <h1 id="auth-title">Harvest Village</h1>
          <p>Plant, grow, harvest and sell. Your farm is waiting.</p>
          <div className="auth-crops" aria-hidden="true">
            <CropIcon cropId="carrot" size={44} />
            <CropIcon cropId="tomato" size={44} />
            <CropIcon cropId="pumpkin" size={44} />
          </div>
        </div>

        <div className="segmented" role="tablist" aria-label="Account">
          {['login', 'register'].map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'is-active' : ''}
              onClick={() => {
                setMode(m);
                setError('');
              }}
            >
              {m === 'login' ? 'Log in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="auth-form" noValidate>
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck="false"
              maxLength={20}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              maxLength={72}
              required
            />
          </label>
          {mode === 'register' && <p className="hint">3-20 letters, numbers or underscores. Password: 8+ characters.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-wide" disabled={loading}>
            {loading ? 'One moment…' : mode === 'login' ? 'Log in' : 'Start farming'}
          </button>
        </form>

        {devMode && (
          <div className="dev-box">
            <strong>Developer tools</strong>
            <span className="dev-tag">dev mode only</span>
            <p>Create two separate demo players for presentations. Open the second one in a private window.</p>
            <div className="row">
              <button type="button" className="btn btn-small" onClick={() => createDemo(false)}>Create demo accounts</button>
              <button type="button" className="btn btn-small" onClick={() => createDemo(true)}>Reset them</button>
            </div>
            {demo && (
              <div className="row demo-logins">
                {demo.map((a) => (
                  <button key={a.username} type="button" className="btn btn-small btn-primary" disabled={loading} onClick={() => loginAs(a)}>
                    Log in as {a.username}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
