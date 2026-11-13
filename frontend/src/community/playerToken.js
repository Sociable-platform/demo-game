// Browser-memory only. No localStorage/sessionStorage and no JWT decoding.
export function createPlayerTokenCache(requestToken, now = () => Date.now()) {
  let state = {cached:null, pending:null, revision:0};
  const listeners = new Set();
  const abort = () => new DOMException('Player session changed or token acquisition superseded.', 'AbortError');
  return {
    clear() {
      state.cached = null; state.pending = null;
      state = {cached:null, pending:null, revision:0};
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get({forceRefresh = false} = {}) {
      const current = state;
      if (current.pending && (!forceRefresh || current.pending.force)) return current.pending.promise;
      if (!forceRefresh && current.cached && now() < current.cached.refreshAt) return Promise.resolve().then(() => {
        if (current !== state) throw abort();
        if (current.pending) return current.pending.promise;
        if (!current.cached) throw abort();
        return current.cached.token;
      });
      current.cached = null;
      const revision = ++current.revision, started = now();
      const pending = {force:forceRefresh, promise:null};
      pending.promise = Promise.resolve().then(() => {
        if (current !== state) throw abort();
        return requestToken({forceRefresh});
      }).then(async data => {
        if (current !== state) throw abort();
        if (revision !== current.revision) {
          if (current.pending) return current.pending.promise;
          if (current.cached) return current.cached.token;
          throw abort();
        }
        // Preserve legacy malformed-token behavior: SDK rejects before Social fetch.
        if (typeof data?.token !== 'string' || !data.token || /\s/.test(data.token)) return data?.token;
        if (data.expiresIn !== undefined && (!Number.isFinite(data.expiresIn) || data.expiresIn <= 0) || data.expiresAt !== undefined && !Number.isFinite(data.expiresAt)) throw new Error('Invalid player token expiry metadata.');
        const relative = Number.isFinite(data.expiresIn) && data.expiresIn > 0 ? started + data.expiresIn * 1000 : Infinity;
        const absolute = Number.isFinite(data.expiresAt) ? data.expiresAt : Infinity;
        const expiry = Math.min(relative, absolute);
        if (!Number.isFinite(expiry)) return data.token; // Older server: usable, never cached.
        if (expiry <= now()) throw new Error('Player token expired during acquisition.');
        const margin = Math.min(30000, (expiry - started) * 0.1);
        current.cached = {token:data.token, refreshAt:expiry - margin};
        return data.token;
      }).finally(() => { if (current.pending === pending) current.pending = null; });
      current.pending = pending;
      return pending.promise;
    },
  };
}
