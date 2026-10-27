import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, adminApi, unwrap } from './api';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adminChecked, setAdminChecked] = useState(false);

  const loadMeta = useCallback(() => unwrap(api.get('/meta')).then(setMeta).catch(() => {}), []);

  // Guests are a normal state: /auth/session always answers 200 ({ user: null }), so visitors see no 401s.
  useEffect(() => {
    let live = true;
    (async () => {
      const [u] = await Promise.allSettled([unwrap(api.get('/auth/session')), loadMeta()]);
      if (!live) return;
      if (u.status === 'fulfilled') setUser(u.value.user || null);
      setLoading(false);
    })();
    return () => { live = false; };
  }, [loadMeta]);

  // The admin session is only probed when an admin screen asks for it (never on public pages).
  const checkAdmin = useCallback(async () => {
    if (adminChecked) return;
    setAdminChecked(true);
    try { const d = await unwrap(adminApi.get('/auth/session')); setAdmin(d.user || null); } catch { setAdmin(null); }
  }, [adminChecked]);

  const value = useMemo(() => ({
    user, admin, adminChecked, checkAdmin, meta, loading, reloadMeta: loadMeta, setUser,
    login: async (body) => { const d = await unwrap(api.post('/auth/login', body)); setUser(d.user); return d.user; },
    googleLogin: async (body) => { const d = await unwrap(api.post('/auth/google', body)); setUser(d.user); return d.user; },
    phoneVerify: async (body) => { const d = await unwrap(api.post('/auth/phone/verify', body)); setUser(d.user); return d.user; },
    register: async (body) => { const d = await unwrap(api.post('/auth/register', body)); setUser(d.user); return d.user; },
    logout: async () => { await api.post('/auth/logout').catch(() => {}); setUser(null); },
    refresh: async () => { const d = await unwrap(api.get('/auth/session')); setUser(d.user || null); return d.user; },
    adminLogin: async (body) => { const d = await unwrap(adminApi.post('/auth/login', body)); setAdmin(d.user); setAdminChecked(true); return d.user; },
    adminLogout: async () => { await adminApi.post('/auth/logout').catch(() => {}); setAdmin(null); },
  }), [user, admin, adminChecked, checkAdmin, meta, loading, loadMeta]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
