import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import AuthScreen from './components/AuthScreen.jsx';
import GameScreen from './components/GameScreen.jsx';
import CommunityChat from './components/CommunityChat.jsx';
import { Toasts, useToasts } from './components/Toasts.jsx';

export default function App() {
  const [phase, setPhase] = useState('loading'); // loading | anon | ready
  const [user, setUser] = useState(null);
  const [devMode, setDevMode] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  useEffect(() => {
    api.config().then((c) => setDevMode(Boolean(c.devMode))).catch(() => {});
    api
      .me()
      .then((r) => {
        setUser(r.user);
        setPhase('ready');
      })
      .catch((err) => {
        setPhase('anon');
        if (err.code === 'network_error') push('error', err.message);
      });
  }, [push]);

  const onAuthed = useCallback((u) => {
    setUser(u);
    setPhase('ready');
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* even if the request fails, drop the local view */
    }
    setUser(null);
    setPhase('anon');
    push('success', 'Logged out. See you soon!');
  }, [push]);

  const sessionExpired = useCallback(() => {
    setUser(null);
    setPhase('anon');
    push('error', 'Your session has ended. Please log in again.');
  }, [push]);

  return (
    <>
      {phase === 'loading' && <p className="loading">Loading…</p>}
      {phase === 'anon' && <AuthScreen devMode={devMode} onAuthed={onAuthed} notify={push} />}
      {phase === 'ready' && user && (
        // Distinct sibling keys also reset each component when the account changes.
        <GameScreen key={`game:${user.id}`} user={user} onLogout={logout} onSessionExpired={sessionExpired} notify={push} />
      )}
      <Toasts toasts={toasts} dismiss={dismiss} />
      {phase === 'ready' && user && <CommunityChat key={`chat:${user.id}`} />}
    </>
  );
}
