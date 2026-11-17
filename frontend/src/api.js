// Thin client for the Harvest Village API. Sessions live in an HttpOnly cookie that the browser sends
// automatically.

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
  register: (username, password) => request('POST', '/auth/register', { username, password }),
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  logout: () => request('POST', '/auth/logout', {}),
  deleteAccount: () => request('DELETE', '/auth/account'),
  me: () => request('GET', '/auth/me'),
  state: () => request('GET', '/game/state'),
  buy: (cropId, quantity) => request('POST', '/game/shop/buy', { cropId, quantity }),
  plant: (plotIndex, cropId) => request('POST', `/game/plots/${plotIndex}/plant`, { cropId }),
  harvest: (plotIndex) => request('POST', `/game/plots/${plotIndex}/harvest`, {}),
  sell: (cropId, quantity) => request('POST', '/game/sell', { cropId, quantity }),
  quest: () => request('GET', '/quest'),
  questContribute: (quantity, idempotencyKey) => request('POST', '/quest/contribute', { quantity, idempotencyKey }),
  questClaim: () => request('POST', '/quest/claim', {}),
  devDemoAccounts: (reset = false) => request('POST', '/dev/demo-accounts', { reset }),
};

// The SDK requests a fresh token through the existing game session when needed.
export async function getClanPlayerToken() {
  const result = await request('POST', '/clan/token', {});
  return result.token;
}
