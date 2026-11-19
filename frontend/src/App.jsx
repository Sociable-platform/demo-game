import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import AuthScreen from './components/AuthScreen.jsx';
import GameScreen from './components/GameScreen.jsx';
import CommunityClans from './components/CommunityClans.jsx';
import { Toasts, useToasts } from './components/Toasts.jsx';

export default function App() {
  const [phase, setPhase] = useState('loading'); // loading | anon | ready
  const [user, setUser] = useState(null);
  const [devMode, setDevMode] = useState(false);
  const [clansOpen, setClansOpen] = useState(false); // the clans window; closes whenever a game drawer opens, and vice versa
  const closeClans = useCallback(() => setClansOpen(false), []);
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
    setClansOpen(false);
    setPhase('anon');
    push('success', 'Logged out. See you soon!');
  }, [push]);

  const sessionExpired = useCallback(() => {
    setUser(null);
    setClansOpen(false);
    setPhase('anon');
    push('error', 'Your session has ended. Please log in again.');
  }, [push]);

  const deleteAccount = useCallback(async () => {
    // Failure leaves the player/game intact; success waits for both cleanups.
    await api.deleteAccount();
    try { localStorage.removeItem(`harvest-village:tutorial-seen:${user.id}`); } catch { /* cosmetic flag */ }
    setUser(null);
    setPhase('anon'); // Unmount game state and destroy/reset the community widget.
    push('success', 'Your account, progress, and Social profile have been deleted.');
  }, [user, push]);

  return (
    <>
      {phase === 'loading' && <p className="loading">Loading…</p>}
      {phase === 'anon' && <AuthScreen devMode={devMode} onAuthed={onAuthed} notify={push} />}
      {phase === 'ready' && user && (
        // Switching accounts resets the game view.
        <GameScreen key={`game:${user.id}`} clansOpen={clansOpen} onCloseClans={closeClans} user={user} onLogout={logout} onDeleteAccount={deleteAccount} onSessionExpired={sessionExpired} notify={push} />
      )}
      <Toasts toasts={toasts} dismiss={dismiss} />
      {phase === 'ready' && user && <CommunityClans key={`clans:${user.id}`} notify={push} open={clansOpen} onOpenChange={setClansOpen} />}
    </>
  );
}

