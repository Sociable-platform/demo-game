import {createPlayerTokenCache} from './community/playerToken.js';
// Thin client for the Harvest Village API. Sessions live in an HttpOnly cookie that the browser sends
// automatically. Clan player tokens are returned on demand and never persisted here.

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the game server. Is the backend running?');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'unknown_error',
      data?.error?.message ?? 'Something went wrong.',
      data?.error?.details,
    );
  }
  return data;
}

export const api = {
  config: () => request('GET', '/config'),
  register: (username, password) => sessionRequest('/auth/register', { username, password }),
  login: (username, password) => sessionRequest('/auth/login', { username, password }),
  logout: () => sessionRequest('/auth/logout', {}),
  me: () => request('GET', '/auth/me'),
  state: () => request('GET', '/game/state'),
  buy: (cropId, quantity) => request('POST', '/game/shop/buy', { cropId, quantity }),
  plant: (plotIndex, cropId) => request('POST', `/game/plots/${plotIndex}/plant`, { cropId }),
  harvest: (plotIndex) => request('POST', `/game/plots/${plotIndex}/harvest`, {}),
  sell: (cropId, quantity) => request('POST', '/game/sell', { cropId, quantity }),
  devDemoAccounts: (reset = false) => request('POST', '/dev/demo-accounts', { reset }),
};

const clanTokens = createPlayerTokenCache(({forceRefresh}) => request('POST', '/clan/token', forceRefresh ? {forceRefresh:true} : {}));
let sessionTransitions = 0;
export const getClanPlayerToken = options => sessionTransitions ? Promise.reject(new DOMException('Player session is changing.', 'AbortError')) : clanTokens.get(options);
export const clearClanPlayerToken = () => clanTokens.clear();
export const onClanPlayerSessionChange = listener => clanTokens.subscribe(listener);
async function sessionRequest(path, body) {
  sessionTransitions++;
  clearClanPlayerToken();
  try { return await request('POST', path, body); }
  finally { sessionTransitions--; clearClanPlayerToken(); }
}

