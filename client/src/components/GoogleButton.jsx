import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { errMsg } from '../lib/api';

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
let scriptPromise;
const loadGsi = () => (scriptPromise ||= new Promise((resolve, reject) => {
  if (window.google?.accounts?.id) return resolve(window.google);
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
  s.onload = () => resolve(window.google); s.onerror = () => { scriptPromise = null; reject(new Error('Google script blocked')); };
  document.head.appendChild(s);
}));

/** Google's own button (required branding), wired to POST /auth/google. Renders nothing if no client ID is configured. */
export default function GoogleButton({ state, dateOfBirth, requireState = false, onDone, onError, text = 'continue_with' }) {
  const { googleLogin, meta } = useAuth();
  const serverOff = meta && meta.googleSignIn === false;
  const box = useRef(null);
  const cb = useRef({}); cb.current = { onDone, onError, state, dateOfBirth, requireState, googleLogin };
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || serverOff) return undefined;
    let live = true;
    loadGsi().then((google) => {
      if (!live || !box.current) return;
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID, ux_mode: 'popup', auto_select: false, use_fedcm_for_prompt: true,
        callback: async ({ credential }) => {
          const c = cb.current;
          if (!credential) { c.onError?.('Google did not return a sign-in credential. Check the OAuth client and try again.'); return; }
          if (c.requireState && !c.state) { c.onError?.('Please choose your state or union territory above, then try Google sign-up again.'); return; }
          if (c.requireState && !c.dateOfBirth) { c.onError?.('Enter your date of birth before using Google sign-up.'); return; }
          try { const u = await c.googleLogin({ credential, state: c.state || undefined, dateOfBirth: c.dateOfBirth || undefined }); c.onDone?.(u); } catch (e) { c.onError?.(errMsg(e, 'Google sign-in failed. Check GOOGLE_CLIENT_ID and authorized origins.')); }
        },
      });
      const width = Math.min(360, box.current.parentElement?.clientWidth || 320);
      google.accounts.id.renderButton(box.current, { type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text, logo_alignment: 'center', width });
    }).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [text, serverOff]);

  if (!GOOGLE_CLIENT_ID || serverOff || failed) return null; // nothing to show: email and phone still work
  return <div className="flex min-h-[44px] justify-center"><div ref={box} /></div>;
}
