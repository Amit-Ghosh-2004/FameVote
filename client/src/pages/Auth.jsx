import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/Toast';
import { Field, StateSelect, Segmented } from '../components/ui';
import GoogleButton, { GOOGLE_CLIENT_ID } from '../components/GoogleButton';

/** Plain, calm form page: heading on the paper, form below. On larger screens the form sits in a bordered card. */
const Shell = ({ title, sub, children, compact = false }) => (
  <section className={`auth-page ${compact ? 'auth-page-register' : ''}`}>
    <div className={`auth-card mx-auto w-full max-w-md ${compact ? 'auth-card-compact' : ''}`}>
      <h1 className={`font-heading font-extrabold leading-[1.02] ${compact ? 'text-[30px] sm:text-[34px]' : 'text-[36px] sm:text-[34px]'}`}>{title}</h1>
      {sub && <p className={`text-ink/65 ${compact ? 'mt-1 text-[13px] sm:text-[15px]' : 'mt-2.5 text-[16px]'}`}>{sub}</p>}
      <div className={compact ? 'mt-3 sm:mt-4' : 'mt-7'}>{children}</div>
    </div>
  </section>
);

const Err = ({ msg }) => (msg ? <p role="alert" className="rounded-2xl bg-brand-soft p-3.5 text-[14px] text-brand-dark">{msg}</p> : null);

function Password({ id, value, onChange, autoComplete, minLength, meter }) {
  const [show, setShow] = useState(false);
  const score = useMemo(() => (meter ? [value.length >= 8, /[A-Za-z]/.test(value) && /\d/.test(value), value.length >= 12, /[^A-Za-z0-9]/.test(value)].filter(Boolean).length : 0), [value, meter]);
  return (
    <>
      <div className="relative">
        <input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} className="input !pr-12" value={value} onChange={(e) => onChange(e.target.value)} minLength={minLength} required />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} className="absolute right-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-ink/55">{show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
      </div>
      {meter && value && (
        <div className="mt-2 flex items-center gap-2" aria-live="polite">
          <div className="flex flex-1 gap-1">{[1, 2, 3, 4].map((n) => <span key={n} className={`h-1.5 flex-1 rounded-full transition-colors ${n <= score ? (score <= 1 ? 'bg-brand' : score <= 2 ? 'bg-ink/50' : 'bg-mint') : 'bg-ink/10'}`} />)}</div>
          <span className="w-14 text-right text-xs font-semibold text-ink/60">{['Too short', 'Weak', 'Okay', 'Good', 'Strong'][score]}</span>
        </div>
      )}
    </>
  );
}

const Or = () => (GOOGLE_CLIENT_ID ? <div className="my-5 flex items-center gap-3 text-xs font-semibold text-ink/45"><span className="h-px flex-1 bg-ink/10" />or use your email<span className="h-px flex-1 bg-ink/10" /></div> : null);


/** Phone sign-in: number, then the 6-digit code we text. Works for new and returning users (no separate sign-up step). */
function PhoneForm({ onDone, withProfile = false, state = '' }) {
  const { phoneVerify } = useAuth();
  const [phone, setPhone] = useState(''); const [name, setName] = useState('');
  const [code, setCode] = useState(''); const [sent, setSent] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [wait, setWait] = useState(0);
  useEffect(() => { if (wait <= 0) return undefined; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const send = async (e) => {
    e?.preventDefault(); setErr('');
    if (withProfile && !state) { setErr('Please choose your state or union territory first.'); return; }
    setBusy(true);
    try { const d = await api.post('/auth/phone/send', { phone }); setSent(true); setWait(d.data?.data?.resendInSeconds || 30); } catch (x) { setErr(errMsg(x, 'Could not send the code.')); } finally { setBusy(false); }
  };
  const verify = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { onDone(await phoneVerify({ phone, code, name: name || undefined, state: state || undefined })); } catch (x) { setErr(errMsg(x, 'That code did not work.')); } finally { setBusy(false); }
  };
  if (!sent) {
    return (
      <form onSubmit={send} className="space-y-4">
        <Err msg={err} />
        {withProfile && <Field label="Full name" id="pn"><input id="pn" autoComplete="name" className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} required /></Field>}
        <Field label="Mobile number" id="pp" hint="We will text you a 6-digit code. Indian numbers need no country code."><input id="pp" type="tel" inputMode="tel" autoComplete="tel" className="input" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} required /></Field>
        <button className="btn-primary w-full !min-h-[54px] text-base" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
      </form>
    );
  }
  return (
    <form onSubmit={verify} className="space-y-4">
      <Err msg={err} />
      <Field label={`Code sent to ${phone}`} id="pc"><input id="pc" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} className="input text-center text-2xl tracking-[.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus required /></Field>
      <button className="btn-primary w-full !min-h-[54px] text-base" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify and continue'}</button>
      <div className="flex justify-between text-sm font-semibold">
        <button type="button" className="min-h-[44px] text-brand" onClick={() => { setSent(false); setCode(''); setErr(''); }}>Change number</button>
        <button type="button" className="min-h-[44px] text-brand disabled:text-ink/40" disabled={wait > 0 || busy} onClick={send}>{wait > 0 ? `Resend in ${wait}s` : 'Resend code'}</button>
      </div>
    </form>
  );
}

function useMethod(defaultMethod = 'phone') {
  const { meta } = useAuth(); const [m, setM] = useState(defaultMethod);
  const phoneOn = Boolean(meta?.phoneSignIn);
  return [phoneOn ? m : 'email', setM, phoneOn];
}
const Method = ({ value, onChange }) => <div className="mb-4"><Segmented label="Sign in with" value={value} onChange={onChange} options={[['email', 'Email'], ['phone', 'Phone']]} /></div>;

function useAfterAuth() {
  const nav = useNavigate(); const loc = useLocation(); const toast = useToast();
  return (u) => {
    if (u && !u.state) { toast('Choose your state to start voting.', 'info'); nav('/dashboard/profile', { replace: true }); }
    else nav(loc.state?.from || '/', { replace: true });
  };
}

export function Login() {
  const { login } = useAuth(); const after = useAfterAuth(); const loc = useLocation();
  const [method, setMethod, phoneOn] = useMethod('phone');
  const [f, setF] = useState({ email: '', password: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { after(await login(f)); } catch (x) { setErr(errMsg(x, 'Could not log in.')); } finally { setBusy(false); } };
  return (
    <Shell title="Welcome back" sub="Log in to vote and see your receipts.">
      <GoogleButton onDone={after} onError={setErr} />
      <Or />
      {phoneOn && <Method value={method} onChange={setMethod} />}
      {method === 'phone' ? <><PhoneForm onDone={after} /><p className="mt-4 text-center text-sm"><Link to="/register" state={loc.state} className="font-semibold text-brand">Create account</Link></p></> : (
      <form onSubmit={submit} className="space-y-4">
        <Err msg={err} />
        <Field label="Email" id="le"><input id="le" type="email" inputMode="email" autoComplete="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label="Password" id="lp"><Password id="lp" autoComplete="current-password" value={f.password} onChange={(v) => setF({ ...f, password: v })} /></Field>
        <button className="btn-primary w-full !min-h-[54px] text-base" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        <div className="flex justify-between text-sm font-semibold"><Link to="/forgot-password" className="flex min-h-[44px] items-center text-brand">Forgot password?</Link><Link to="/register" state={loc.state} className="flex min-h-[44px] items-center text-brand">Create account</Link></div>
      </form>)}
    </Shell>
  );
}

export function Register() {
  const { register, meta } = useAuth(); const after = useAfterAuth(); const toast = useToast();
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: '', state: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!f.state) { setErr('Please choose your state or union territory before creating your account.'); return; }
    setBusy(true);
    try { const u = await register({ ...f, state: f.state }); toast('Account created successfully.', 'success'); after(u); } catch (x) { setErr(x?.response?.data?.error?.details?.map((d) => d.message).join(' ') || errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Shell title="Create your account" sub="Get started with your mobile number.">
      <Err msg={err} />
      <PhoneForm onDone={(u) => { toast('Account ready.', 'success'); after(u); }} />
      <p className="mt-4 text-center text-sm">Already have an account? <Link to="/login" className="font-semibold text-brand">Log in</Link></p>

      <button type="button" className="mt-3 min-h-[44px] w-full text-sm font-semibold text-ink/65 underline-offset-4 hover:underline" aria-expanded={showAlternatives} onClick={() => setShowAlternatives((v) => !v)}>
        {showAlternatives ? 'Hide other sign-up options' : 'Prefer email or Google?'}
      </button>

      {showAlternatives && <div className="auth-email-alternative">
        <Field label="State / union territory" id="gs" hint="Choose your state to personalize rankings.">
          <StateSelect id="gs" states={meta?.states} value={f.state} onChange={(v) => setF((s) => ({ ...s, state: v }))} required />
        </Field>
        <GoogleButton state={f.state} requireState onDone={after} onError={setErr} text="signup_with" />
        <div className="auth-secondary-divider"><span>OR SIGN UP WITH EMAIL</span></div>
        <form onSubmit={submit} className="auth-register-stack">
          <Field label="Full name" id="rn"><input id="rn" autoComplete="name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} minLength={2} required /></Field>
          <Field label="Email" id="re"><input id="re" type="email" inputMode="email" autoComplete="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
          <Field label="Password" id="rp" hint="At least 8 characters, including a letter and a number."><Password id="rp" meter autoComplete="new-password" minLength={8} value={f.password} onChange={(v) => setF({ ...f, password: v })} /></Field>
          <button className="btn-primary w-full !min-h-[50px] text-base" disabled={busy}>{busy ? 'Creating…' : 'Create account with email'}</button>
        </form>
      </div>}
    </Shell>
  );
}

export function Forgot() {
  const [email, setEmail] = useState(''); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await api.post('/auth/forgot-password', { email }); setDone(true); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } };
  return (
    <Shell title="Forgot your password?" sub="Enter your email and we will send a reset link.">
      {done ? <p className="rounded-2xl bg-mint-soft p-4 text-[15px] text-mint" role="status">If an account exists for that email, a reset link is on its way. If you signed up with Google, use the Google button on the login page instead.</p> : (
        <form onSubmit={submit} className="space-y-4"><Err msg={err} /><Field label="Email" id="fe"><input id="fe" type="email" inputMode="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <button className="btn-primary w-full !min-h-[54px] text-base" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button></form>)}
    </Shell>
  );
}

export function Reset() {
  const [sp] = useSearchParams(); const nav = useNavigate(); const toast = useToast();
  const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await api.post('/auth/reset-password', { token: sp.get('token'), password }); toast('Password updated. Please log in.', 'success'); nav('/login'); } catch (x) { setErr(x?.response?.data?.error?.details?.map((d) => d.message).join(' ') || errMsg(x)); } finally { setBusy(false); } };
  return (
    <Shell title="Choose a new password">
      <form onSubmit={submit} className="space-y-4"><Err msg={err} />
        <Field label="New password" id="np" hint="8+ characters with a letter and a number."><Password id="np" meter autoComplete="new-password" minLength={8} value={password} onChange={setPassword} /></Field>
        <button className="btn-primary w-full !min-h-[54px] text-base" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button></form>
    </Shell>
  );
}
