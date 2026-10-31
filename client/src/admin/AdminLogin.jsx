import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { errMsg } from '../lib/api';
import { Field } from '../components/ui';
import { ThemeToggle } from '../lib/theme';

export default function AdminLogin() {
  const { admin, adminLogin, checkAdmin } = useAuth(); const nav = useNavigate();
  useEffect(() => { checkAdmin(); }, [checkAdmin]);
  const [f, setF] = useState({ email: '', password: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (admin) return <Navigate to="/admin" replace />;
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await adminLogin(f); nav('/admin'); } catch (x) { setErr(errMsg(x, 'Could not sign in.')); } finally { setBusy(false); } };
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-brand" /><h1 className="text-xl font-bold">FameVote Admin</h1></div><ThemeToggle /></div>
        {err && <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{err}</p>}
        <Field label="Email" id="ae"><input id="ae" type="email" autoComplete="username" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label="Password" id="ap"><input id="ap" type="password" autoComplete="current-password" className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="text-center text-xs text-ink/50">Authorised staff only. Activity is logged.</p>
      </form>
    </main>
  );
}
