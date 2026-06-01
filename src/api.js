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

export const api = {
  register: (email, password) =>
    request('/auth/register', { method: 'POST', body: { email, password }, auth: false }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  listAccounts: () => request('/accounts'),
  createAccount: (body) => request('/accounts', { method: 'POST', body }),
  importCsv: (accountId, csv, broker) =>
    request('/import', { method: 'POST', body: { accountId, csv, broker } }),
  getTrades: (accountId) => request(`/trades?accountId=${accountId}`),
  tagTrade: (id, tags) => request(`/trades/${id}`, { method: 'PATCH', body: { tags } }),
  getMetrics: (accountId) => request(`/metrics?accountId=${accountId}`),
  getCalendar: (accountId, year, month) =>
    request(`/calendar?accountId=${accountId}&year=${year}&month=${month}`),
  getDay: (accountId, date) =>
    request(`/day?accountId=${accountId}&date=${date}`),
  getAnalytics: (accountId) => request(`/analytics?accountId=${accountId}`),
};
