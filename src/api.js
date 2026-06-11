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
  register: (email, password, source) =>
    request('/auth/register', { method: 'POST', body: { email, password, source }, auth: false }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  authConfig: () => request('/auth/config', { auth: false }),
  googleLogin: (idToken) =>
    request('/auth/google', { method: 'POST', body: { idToken }, auth: false }),
  appleLogin: (idToken) =>
    request('/auth/apple', { method: 'POST', body: { idToken }, auth: false }),
  startDemo: () => request('/demo', { method: 'POST', auth: false }),
  joinWaitlist: (email) => request('/waitlist', { method: 'POST', body: { email }, auth: false }),
  forgotPassword: (email) => request('/auth/forgot', { method: 'POST', body: { email }, auth: false }),
  resetPassword: (token, password) => request('/auth/reset', { method: 'POST', body: { token, password }, auth: false }),
  changePassword: (currentPassword, newPassword) => request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
  deleteMe: () => request('/me', { method: 'DELETE' }),
  importData: (body) => request('/me/import-data', { method: 'POST', body }),
  getViews: () => request('/me/views'),
  saveViews: (views) => request('/me/views', { method: 'PUT', body: { views } }),
  getEmailPrefs: () => request('/me/email-prefs'),
  setEmailPrefs: (digest) => request('/me/email-prefs', { method: 'PUT', body: { digest } }),
  billingStatus: () => request('/billing/status'),
  startCheckout: () => request('/billing/checkout', { method: 'POST' }),
  mockCompleteCheckout: () => request('/billing/mock-complete', { method: 'POST' }),
  openBillingPortal: () => request('/billing/portal', { method: 'POST' }),
  adminStats: () => request('/admin/stats'),
  sendDigests: () => request('/admin/send-digests', { method: 'POST' }),
  listAccounts: () => request('/accounts'),
  createAccount: (body) => request('/accounts', { method: 'POST', body }),
  loadSampleData: () => request('/me/sample-data', { method: 'POST' }),
  getGoals: () => request('/me/goals'),
  setGoals: (body) => request('/me/goals', { method: 'PUT', body }),
  updateAccount: (id, body) => request(`/accounts/${id}`, { method: 'PATCH', body }),
  deleteAccount: (id) => request(`/accounts/${id}`, { method: 'DELETE' }),
  renameTag: (accountId, from, to) =>
    request(`/accounts/${accountId}/tags/rename`, { method: 'POST', body: { from, to } }),
  removeTag: (accountId, tag) =>
    request(`/accounts/${accountId}/tags/delete`, { method: 'POST', body: { tag } }),
  importCsv: (accountId, csv, broker, mode, mapping) =>
    request('/import', { method: 'POST', body: { accountId, csv, broker, mode, mapping } }),
  previewCsv: (csv) => request('/import/preview', { method: 'POST', body: { csv } }),
  getTrades: (accountId, range = {}) => request(`/trades?accountId=${accountId}${qs(range)}`),
  tagTrade: (id, tags) => request(`/trades/${id}`, { method: 'PATCH', body: { tags } }),
  setTradeRisk: (id, riskAmount) => request(`/trades/${id}`, { method: 'PATCH', body: { riskAmount } }),
  setTradeNote: (id, note) => request(`/trades/${id}`, { method: 'PATCH', body: { note } }),
  setTradeSetup: (id, setup) => request(`/trades/${id}`, { method: 'PATCH', body: { setup } }),
  getMetrics: (accountId, range = {}) => request(`/metrics?accountId=${accountId}${qs(range)}`),
  getCalendar: (accountId, year, month, basis) =>
    request(`/calendar?accountId=${accountId}&year=${year}&month=${month}${qs({ basis })}`),
  getDay: (accountId, date) =>
    request(`/day?accountId=${accountId}&date=${date}`),
  getAnalytics: (accountId, range = {}) => request(`/analytics?accountId=${accountId}${qs(range)}`),
  getStatistics: (accountId, range = {}) => request(`/statistics?accountId=${accountId}${qs(range)}`),
  getPlaybook: (accountId, range = {}) => request(`/playbook?accountId=${accountId}${qs(range)}`),
  getYear: (accountId, year, basis) =>
    request(`/year?accountId=${accountId}&year=${year}${qs({ basis })}`),
  setDayNote: (accountId, date, note) =>
    request('/day/note', { method: 'PUT', body: { accountId, date, note } }),
};
