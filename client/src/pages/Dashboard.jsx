import { useState } from 'react';
import { Link, NavLink, useParams, useNavigate } from 'react-router-dom';
import { Camera, ChevronRight, LogOut } from 'lucide-react';
import { useToast } from '../lib/Toast';
import { api, unwrap, errMsg, inr, fmtIST } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useAuth } from '../lib/AuthContext';
import { Skeleton, ErrorState, EmptyState, Field, StateSelect, CelebrityCard, SkeletonGrid } from '../components/ui';

const TABS = [['', 'Overview'], ['votes', 'My votes'], ['receipts', 'Receipts'], ['payments', 'Payments'], ['favorites', 'Favourites'], ['notifications', 'Notifications'], ['profile', 'Profile']];
const statusTone = { paid: 'bg-mint-soft text-mint', refunded: 'bg-brand-soft text-brand', failed: 'bg-brand-soft text-brand-dark', cancelled: 'bg-ink/[.07] text-ink/70', expired: 'bg-ink/[.07] text-ink/70', created: 'bg-sand text-ink', requires_reconciliation: 'bg-sand text-ink', refund_pending: 'bg-sand text-ink', refund_failed: 'bg-brand-soft text-brand-dark' };

function Overview() {
  const d = useAsync(() => unwrap(api.get('/me/dashboard')), []);
  if (d.loading) return <div className="space-y-3"><Skeleton className="h-32" /><Skeleton className="h-24" /></div>;
  if (d.error) return <ErrorState message="Could not load your dashboard." onRetry={d.reload} />;
  const { eligibility: e, thisMonth: m, campaign, amountInr } = d.data;
  const total = m.votesCast + m.categoriesRemaining.length;
  const pct = total ? Math.round((m.votesCast / total) * 100) : 0;
  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-brand/40 bg-gradient-to-br from-brand/25 via-surface to-surface p-5 shadow-glow" aria-label="This month">
        <p className="text-sm text-ink/60">{campaign.title}</p>
        <div className="mt-2 flex items-end justify-between gap-4">
          <p className="font-heading text-[52px] font-extrabold leading-none tnum">{m.votesCast}<span className="text-2xl text-ink/40"> / {total}</span></p>
          <p className="pb-1 text-right text-sm text-ink/60">categories voted<br />up to ₹7 per vote</p>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Ballot progress"><div className="h-full rounded-full bg-gradient-to-r from-brand to-amber transition-all duration-700" style={{ width: `${pct}%` }} /></div>
        <p className="mt-3 text-[14px] text-ink/65">{e.canVote ? (m.categoriesRemaining.length ? 'Your ballot is not complete yet.' : 'Your ballot is complete. See you next month!') : !e.stateSet ? 'Choose your state to start voting.' : 'Voting is closed right now.'}</p>
      </section>

      {!e.stateSet && <div className="rounded-2xl bg-sand p-4 text-[15px] text-ink">Set your state in <Link className="font-semibold underline" to="/dashboard/profile">Profile</Link> to start voting.</div>}

      {m.categoriesRemaining.length > 0 && e.canVote && (
        <section><h2 className="mb-2 font-heading text-lg font-extrabold">Still to vote in</h2>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface px-4">{m.categoriesRemaining.map((c) => (
            <li key={c.id}><Link to={`/vote?category=${c.slug}`} className="flex min-h-[56px] items-center justify-between text-[15px] font-semibold">{c.name}<ChevronRight className="h-4 w-4 text-ink/40" aria-hidden="true" /></Link></li>))}</ul></section>)}
    </div>
  );
}

function Votes() {
  const r = useAsync(() => unwrap(api.get('/votes/mine')), []);
  if (r.loading) return <Skeleton className="h-48" />; if (r.error) return <ErrorState message="Could not load votes." onRetry={r.reload} />;
  if (!r.data.votes.length) return <EmptyState title="No votes yet" text="Your confirmed votes will appear here." action={<Link to="/vote" className="btn-primary mt-2">Vote now</Link>} />;
  return <div className="divide-y divide-line rounded-xl border border-line bg-surface px-4">{r.data.votes.map((v) => (
    <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
      <div><p className="font-semibold">{v.celebrity?.name}</p><p className="text-xs text-ink/60">{v.category?.name} · {v.campaign?.title} · {fmtIST(v.createdAt)}</p></div>
      <div className="flex items-center gap-2">{v.status === 'disqualified' && <span className="badge bg-brand-soft text-brand-dark">Disqualified</span>}{v.receiptId && <Link to={`/dashboard/receipts/${v.receiptId}`} className="btn-ghost !min-h-[36px]">Receipt</Link>}</div></div>))}</div>;
}

function Receipts() {
  const r = useAsync(() => unwrap(api.get('/receipts')), []);
  if (r.loading) return <Skeleton className="h-48" />; if (r.error) return <ErrorState message="Could not load receipts." onRetry={r.reload} />;
  if (!r.data.receipts.length) return <EmptyState title="No receipts yet" text="A receipt is issued for every confirmed vote." />;
  return <div className="divide-y divide-line rounded-xl border border-line bg-surface px-4">{r.data.receipts.map((x) => (
    <Link key={x.id} to={`/dashboard/receipts/${x.id}`} className="flex items-center justify-between gap-2 p-4 text-sm active:bg-ink/[.03]"><div><p className="font-semibold">{x.celebrityName}</p><p className="text-xs text-ink/60">{x.categoryName} · {x.campaignLabel} · {x.receiptNo}</p></div><span className="font-semibold">{inr(x.amountInr)}</span></Link>))}</div>;
}

function Payments() {
  const r = useAsync(() => unwrap(api.get('/payments/mine')), []);
  if (r.loading) return <Skeleton className="h-48" />; if (r.error) return <ErrorState message="Could not load payments." onRetry={r.reload} />;
  if (!r.data.payments.length) return <EmptyState title="No payments yet" />;
  return <div className="divide-y divide-line rounded-xl border border-line bg-surface px-4">{r.data.payments.map((p) => (
    <div key={p.id} className="space-y-1 p-4 text-sm"><div className="flex items-center justify-between"><span className="font-semibold">{inr(p.amountInr)} · {p.method === 'free' ? 'Free vote' : 'Razorpay'}</span><span className={`badge ${statusTone[p.status] || 'bg-sand'}`}>{p.status.replaceAll('_', ' ')}</span></div>
      <p className="text-xs text-ink/60">{fmtIST(p.createdAt)}{p.razorpayPaymentId ? ` · ${p.razorpayPaymentId}` : ''}</p>{p.note && <p className="text-xs text-ink">{p.note}</p>}</div>))}</div>;
}

function Favorites() {
  const r = useAsync(() => unwrap(api.get('/me/favorites')), []);
  if (r.loading) return <SkeletonGrid n={4} />; if (r.error) return <ErrorState message="Could not load favourites." onRetry={r.reload} />;
  if (!r.data.favorites.length) return <EmptyState title="No favourites yet" text="Tap the heart on a celebrity profile to save them here." />;
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{r.data.favorites.map((c) => <CelebrityCard key={c.id} celeb={c} />)}</div>;
}

function Notifications() {
  const r = useAsync(() => unwrap(api.get('/me/notifications')), []);
  if (r.loading) return <Skeleton className="h-48" />; if (r.error) return <ErrorState message="Could not load notifications." onRetry={r.reload} />;
  const list = r.data.notifications;
  if (!list.length) return <EmptyState title="You're all caught up" />;
  return (<div className="space-y-2"><button className="btn-ghost !min-h-[36px]" onClick={async () => { await api.post('/me/notifications/read'); r.reload(); }}>Mark all as read</button>
    <div className="divide-y divide-line rounded-xl border border-line bg-surface px-4">{list.map((n) => <div key={n.id} className={`p-4 text-sm ${n.read ? '' : 'bg-sand/60'}`}><p className="font-semibold">{n.title}</p>{n.body && <p className="text-ink/70">{n.body}</p>}<div className="mt-1 flex gap-3 text-xs text-ink/50"><span>{fmtIST(n.createdAt)}</span>{n.link && <Link className="text-brand" to={n.link}>Open</Link>}</div></div>)}</div></div>);
}

function Profile() {
  const { user, meta, setUser, refresh } = useAuth(); const toast = useToast();
  const [f, setF] = useState({ name: user.name, state: user.state || '' }); const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const hasPassword = user.hasPassword !== false;
  const save = async (e) => { e.preventDefault(); setBusy(true); try { const d = await unwrap(api.patch('/auth/profile', { name: f.name, state: f.state || undefined })); setUser(d.user); toast('Profile saved.', 'success'); } catch (x) { toast(errMsg(x), 'error'); } finally { setBusy(false); } };
  const avatar = async (e) => { const file = e.target.files?.[0]; if (!file) return; const fd = new FormData(); fd.append('image', file); try { await api.put('/me/avatar', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); await refresh(); toast('Photo updated.', 'success'); } catch (x) { toast(errMsg(x), 'error'); } };
  const changePw = async (e) => { e.preventDefault(); try { await api.post('/auth/change-password', hasPassword ? pw : { newPassword: pw.newPassword }); setPw({ currentPassword: '', newPassword: '' }); await refresh(); toast(hasPassword ? 'Password changed.' : 'Password set. You can now log in with email too.', 'success'); } catch (x) { toast(x?.response?.data?.error?.details?.map((d) => d.message).join(' ') || errMsg(x), 'error'); } };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form onSubmit={save} className="space-y-4 rounded-2xl border border-line bg-surface p-5"><h2 className="font-heading text-lg font-extrabold">Profile</h2>
        <div className="flex items-center gap-4">
          <label className="relative grid h-20 w-20 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full bg-ink font-heading text-3xl font-extrabold text-paper">
            {user.avatar?.url ? <img src={user.avatar.url} alt="" className="h-full w-full object-cover" /> : user.name?.[0]?.toUpperCase()}
            <span className="absolute inset-x-0 bottom-0 grid h-7 place-items-center bg-black/60 text-white"><Camera className="h-3.5 w-3.5" aria-hidden="true" /></span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={avatar} className="sr-only" aria-label="Change profile photo" />
          </label>
          <p className="text-[13px] text-ink/60">Tap the photo to change it. JPEG, PNG or WebP, up to 5 MB.</p>
        </div>
        <Field label="Name" id="pn"><input id="pn" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} minLength={2} required /></Field>
        <Field label={user.email ? 'Email' : 'Mobile number'} id="pe" hint={user.hasGoogle ? 'Signed in with Google.' : undefined}><input id="pe" className="input !bg-paper" value={user.email || user.phone || ''} readOnly /></Field>
        <Field label="State / UT" id="ps" hint="Changing this only affects future votes. Past votes keep the state you voted from."><StateSelect id="ps" states={meta?.states} value={f.state} onChange={(v) => setF({ ...f, state: v })} /></Field>
        <button className="btn-primary w-full" disabled={busy}>Save changes</button></form>
      {user.email && <form onSubmit={changePw} className="h-fit space-y-4 rounded-2xl border border-line bg-surface p-5"><h2 className="font-heading text-lg font-extrabold">{hasPassword ? 'Change password' : 'Add a password'}</h2>
        {!hasPassword && <p className="text-[14px] text-ink/65">You sign in with Google. Adding a password lets you log in with your email too.</p>}
        {hasPassword && <Field label="Current password" id="cp"><input id="cp" type="password" autoComplete="current-password" className="input" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required /></Field>}
        <Field label="New password" id="npw" hint="8+ characters with a letter and a number."><input id="npw" type="password" autoComplete="new-password" className="input" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} minLength={8} required /></Field>
        <button className="btn-ghost w-full">{hasPassword ? 'Update password' : 'Set password'}</button></form>}
    </div>
  );
}

const VIEWS = { '': Overview, votes: Votes, receipts: Receipts, payments: Payments, favorites: Favorites, notifications: Notifications, profile: Profile };

export default function Dashboard() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const { tab = '' } = useParams();
  const View = VIEWS[tab] || Overview;
  return (
    <div className="container-x pt-6">
      <div className="flex items-center gap-3.5">
        <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-brand font-heading text-2xl font-extrabold text-on ring-2 ring-brand/40 ring-offset-2 ring-offset-paper">
          {user.avatar?.url ? <img src={user.avatar.url} alt="" className="h-full w-full object-cover" /> : user.name?.[0]?.toUpperCase()}
        </span>
        <div className="min-w-0 flex-1"><h1 className="break-words font-heading text-[clamp(22px,7vw,28px)] font-extrabold leading-[1.1]">{user.name}</h1><p className="mt-1 truncate text-[13px] text-ink/55">{user.email || user.phone}</p></div>
        <button onClick={async () => { await logout(); nav('/'); }} aria-label="Log out" className="grid h-11 w-11 place-items-center rounded-lg border border-ink/15 bg-surface lg:hidden"><LogOut className="h-5 w-5" strokeWidth={1.75} /></button>
      </div>
      <div className="rail mb-5 mt-4" role="tablist">
        {TABS.map(([to, label]) => <NavLink key={to} to={`/dashboard${to ? `/${to}` : ''}`} end role="tab" className="tab">{label}</NavLink>)}
      </div>
      <View />
    </div>
  );
}
