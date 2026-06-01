import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api, setSession } from '../api.js';

// Load an external script once (memoized by src), resolving when ready.
const scriptCache = new Map();
function loadScript(src) {
  if (scriptCache.has(src)) return scriptCache.get(src);
  const p = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
  scriptCache.set(src, p);
  return p;
}

export default function Auth({ onAuthed }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState({ google: { enabled: false }, apple: { enabled: false } });
  const googleBtnRef = useRef(null);

  const completeOauth = useCallback(async (promise) => {
    setError('');
    setBusy(true);
    try {
      const { token, user } = await promise;
      setSession(token, user);
      onAuthed(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [onAuthed]);

  // Discover which third-party providers the server has configured.
  useEffect(() => {
    api.authConfig().then((c) => setProviders(c.providers)).catch(() => {});
  }, []);

  // Render the official Google Identity Services button when enabled.
  useEffect(() => {
    const g = providers.google;
    if (!g || !g.enabled || !g.clientId || !googleBtnRef.current) return;
    let cancelled = false;
    loadScript('https://accounts.google.com/gsi/client').then(() => {
      if (cancelled || !window.google || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: g.clientId,
        callback: (resp) => completeOauth(api.googleLogin(resp.credential)),
      });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline', size: 'large', width: 320, text: 'continue_with',
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [providers, completeOauth]);

  const handleApple = useCallback(async () => {
    const a = providers.apple;
    if (!a || !a.enabled || !a.clientId) return;
    try {
      await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
      window.AppleID.auth.init({
        clientId: a.clientId,
        scope: 'email',
        redirectURI: window.location.origin,
        usePopup: true,
      });
      const data = await window.AppleID.auth.signIn();
      const idToken = data?.authorization?.id_token;
      if (idToken) completeOauth(api.appleLogin(idToken));
    } catch (err) {
      if (err && err.error !== 'popup_closed_by_user') setError('Apple sign-in failed');
    }
  }, [providers, completeOauth]);

  const submit = async (e) => {
    e.preventDefault();
    completeOauth((mode === 'login' ? api.login : api.register)(email, password));
  };

  const ssoEnabled = providers.google?.enabled || providers.apple?.enabled;

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <span className="dot" />
          <span>TradeJournal<small> Simplified</small></span>
        </div>
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="sub">
          {mode === 'login'
            ? 'Sign in to your trading analytics dashboard.'
            : 'Start journaling and analyzing your trades.'}
        </p>
        {error && <div className="banner error" style={{ marginBottom: 14 }}>{error}</div>}

        {ssoEnabled && (
          <div className="sso-group">
            {providers.google?.enabled && <div ref={googleBtnRef} className="sso-google" />}
            {providers.apple?.enabled && (
              <button type="button" className="sso-apple" onClick={handleApple} disabled={busy}>
                 Continue with Apple
              </button>
            )}
            <div className="sso-divider"><span>or</span></div>
          </div>
        )}

        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
            />
          </div>
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div className="auth-switch">
          {mode === 'login' ? "Don't have an account?" : 'Already registered?'}
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}
