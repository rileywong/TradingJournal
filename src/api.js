// Thin fetch wrapper with token persistence in localStorage.

const TOKEN_KEY = 'tjs_token';
const USER_KEY = 'tjs_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}
export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// Append non-empty query params (e.g. period from/to bounds).
function qs(params = {}) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
    .join('');
}

export const api = {
  register: (email, password) =>
    request('/auth/register', { method: 'POST', body: { email, password }, auth: false }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  listAccounts: () => request('/accounts'),
  createAccount: (body) => request('/accounts', { method: 'POST', body }),
  updateAccount: (id, body) => request(`/accounts/${id}`, { method: 'PATCH', body }),
  deleteAccount: (id) => request(`/accounts/${id}`, { method: 'DELETE' }),
  importCsv: (accountId, csv, broker) =>
    request('/import', { method: 'POST', body: { accountId, csv, broker } }),
  getTrades: (accountId, range = {}) => request(`/trades?accountId=${accountId}${qs(range)}`),
  tagTrade: (id, tags) => request(`/trades/${id}`, { method: 'PATCH', body: { tags } }),
  setTradeRisk: (id, riskAmount) => request(`/trades/${id}`, { method: 'PATCH', body: { riskAmount } }),
  setTradeNote: (id, note) => request(`/trades/${id}`, { method: 'PATCH', body: { note } }),
  getMetrics: (accountId, range = {}) => request(`/metrics?accountId=${accountId}${qs(range)}`),
  getCalendar: (accountId, year, month, basis) =>
    request(`/calendar?accountId=${accountId}&year=${year}&month=${month}${qs({ basis })}`),
  getDay: (accountId, date) =>
    request(`/day?accountId=${accountId}&date=${date}`),
  getAnalytics: (accountId, range = {}) => request(`/analytics?accountId=${accountId}${qs(range)}`),
  getYear: (accountId, year, basis) =>
    request(`/year?accountId=${accountId}&year=${year}${qs({ basis })}`),
  setDayNote: (accountId, date, note) =>
    request('/day/note', { method: 'PUT', body: { accountId, date, note } }),
};
