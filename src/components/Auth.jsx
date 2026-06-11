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

export default function Auth({ onAuthed, initialMode = 'login', onBack, resetToken }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false); // forgot-password confirmation
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
    if (mode === 'forgot') {
      setError('');
      setBusy(true);
      try { await api.forgotPassword(email); setSent(true); }
      catch (err) { setError(err.message); }
      finally { setBusy(false); }
      return;
    }
    if (mode === 'reset') {
      completeOauth(api.resetPassword(resetToken, password));
      return;
    }
    completeOauth((mode === 'login' ? api.login : api.register)(email, password));
  };

  const ssoEnabled = (providers.google?.enabled || providers.apple?.enabled) && (mode === 'login' || mode === 'register');
  const TITLES = { login: 'Welcome back', register: 'Create your account', forgot: 'Reset your password', reset: 'Choose a new password' };
  const SUBS = {
    login: 'Sign in to your trading analytics dashboard.',
    register: 'Start journaling and analyzing your trades.',
    forgot: "Enter your email and we'll send a reset link.",
    reset: 'Pick a new password for your account.',
  };
  const CTA = { login: 'Sign in', register: 'Create account', forgot: 'Send reset link', reset: 'Reset password' };
  const goto = (m) => { setMode(m); setError(''); setSent(false); };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        {onBack && (
          <button type="button" className="auth-back" onClick={onBack}>← Back</button>
        )}
        <div className="brand">
          <span className="dot" />
          <span>Greenstreak</span>
        </div>
        <h1>{TITLES[mode]}</h1>
        <p className="sub">{SUBS[mode]}</p>
        {error && <div className="banner error" style={{ marginBottom: 14 }}>{error}</div>}
        {mode === 'forgot' && sent && (
          <div className="banner success" style={{ marginBottom: 14 }}>
            If an account exists for that email, a reset link is on its way.
          </div>
        )}

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

        {!(mode === 'forgot' && sent) && (
          <form onSubmit={submit}>
            {mode !== 'reset' && (
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
            )}
            {mode !== 'forgot' && (
              <div className="field">
                <div className="field-label-row">
                  <label>{mode === 'reset' ? 'New password' : 'Password'}</label>
                  {mode === 'login' && (
                    <button type="button" className="auth-link" onClick={() => goto('forgot')}>Forgot password?</button>
                  )}
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                />
              </div>
            )}
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : CTA[mode]}
            </button>
          </form>
        )}
        <div className="auth-switch">
          {mode === 'login' && (
            <>Don't have an account? <button onClick={() => goto('register')}>Sign up</button></>
          )}
          {mode === 'register' && (
            <>Already registered? <button onClick={() => goto('login')}>Sign in</button></>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <>Remember it? <button onClick={() => goto('login')}>Back to sign in</button></>
          )}
        </div>
      </div>
    </div>
  );
}
