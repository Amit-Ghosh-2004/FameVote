import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Download } from 'lucide-react';
import { adminApi, unwrap, errMsg, inr, fmtIST, fmtNum } from '../lib/api';
import { useAsync, useDebounced } from '../lib/hooks';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/Toast';
import { PageTitle, Skeleton, ErrorState, EmptyState, Modal, Field, Pagination, CampaignBadge, StateSelect } from '../components/ui';

const Load = ({ r, children }) => r.loading ? <Skeleton className="h-64" /> : r.error ? <ErrorState message={errMsg(r.error)} onRetry={r.reload} /> : children;
const Tbl = ({ head, children }) => <div className="card relative overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-ink/[.05] text-xs uppercase tracking-wide text-ink/60"><tr>{head.map((h) => <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y divide-line">{children}</tbody></table></div>;
const Td = ({ children, className = '' }) => <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>;
const tone = { active: 'bg-mint-soft text-mint', inactive: 'bg-ink/[.07] text-ink/70', archived: 'bg-sand text-ink', paid: 'bg-mint-soft text-mint', failed: 'bg-brand-soft text-brand-dark', refunded: 'bg-sand text-ink', created: 'bg-sand text-ink', pending: 'bg-sand text-ink', suspended: 'bg-brand-soft text-brand-dark', requires_reconciliation: 'bg-sand text-ink', refund_failed: 'bg-brand-soft text-brand-dark' };
const Pill = ({ s }) => <span className={`badge ${tone[s] || 'bg-ink/[.07] text-ink/70'}`}>{String(s).replaceAll('_', ' ')}</span>;
const useAct = () => { const toast = useToast(); return async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok, 'success'); return r ?? true; } catch (e) { toast(errMsg(e), 'error'); return false; } }; };
const reasonPrompt = (label) => { const r = window.prompt(label); return r && r.trim().length >= 5 ? r.trim() : null; };
const reportUrl = (type, campaign) => `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/api/admin/reports?type=${type}${campaign ? `&campaign=${campaign}` : ''}`;

/* ------------------------------ Overview ------------------------------ */
export function Overview() {
  const r = useAsync(() => unwrap(adminApi.get('/dashboard')), []);
  return (<><PageTitle title="Overview" sub="Live figures calculated from the database." /><Load r={r}>{r.data && (() => { const { stats: s, alerts, recentActions, currentCampaign } = r.data; return (
    <div className="space-y-5">
      {alerts.map((a, i) => <div key={i} role="alert" className={`rounded-xl p-3 text-sm ${a.level === 'error' ? 'bg-brand-soft text-brand' : 'bg-sand text-ink'}`}>{a.message}</div>)}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Registered users', s.totalRegisteredUsers], ['Active campaigns', s.activeCampaigns], ['Active categories', s.activeCategories], ['Recorded votes (all)', s.totalRecordedVotes], ['Valid confirmed votes', s.validConfirmedVotes], ['Verified gateway payments', inr(s.totalVerifiedGatewayPaymentsInr)], ['Pending nominations', s.pendingNominations]].map(([l, v]) => <div key={l} className="card p-4"><p className="font-heading text-2xl font-extrabold">{typeof v === 'number' ? fmtNum(v) : v}</p><p className="text-xs text-ink/60">{l}</p></div>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4"><h2 className="mb-2 flex items-center gap-2 font-heading font-bold">Current campaign <CampaignBadge campaign={currentCampaign} /></h2><p className="text-sm">{currentCampaign.title}</p><p className="text-xs text-ink/60">{fmtIST(currentCampaign.startsAt)} → {fmtIST(currentCampaign.endsAt)}</p></div>
        <div className="card p-4"><h2 className="mb-2 font-heading font-bold">Payments by status</h2>{s.paymentsByStatus.length ? <ul className="space-y-1 text-sm">{s.paymentsByStatus.map((p) => <li key={p.status} className="flex justify-between"><Pill s={p.status} /><span>{p.count} · {inr(p.amountInr)}</span></li>)}</ul> : <p className="text-sm text-ink/60">No payments yet.</p>}</div>
      </div>
      <div className="card p-4"><h2 className="mb-2 font-heading font-bold">Recent administrative actions</h2>{recentActions.length ? <ul className="divide-y divide-line text-sm">{recentActions.map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span><strong>{a.action}</strong> {a.reason && <em className="text-ink/60">— {a.reason}</em>}</span><span className="text-xs text-ink/55">{a.by} · {fmtIST(a.at)}</span></li>)}</ul> : <p className="text-sm text-ink/60">Nothing yet.</p>}</div>
    </div>); })()}</Load></>);
}

/* ------------------------------ Categories ------------------------------ */
export function Categories() {
  const { admin } = useAuth(); const act = useAct();
  const r = useAsync(() => unwrap(adminApi.get('/categories')), []);
  const [edit, setEdit] = useState(null);
  const canManage = admin.role !== 'moderator';
  const save = async (e) => { e.preventDefault(); const { id, ...b } = edit; const body = { name: b.name, description: b.description, icon: b.icon, status: b.status, ...(b.slug ? { slug: b.slug } : {}) };
    const ok = await act(() => (id ? adminApi.patch(`/categories/${id}`, body) : adminApi.post('/categories', body)), 'Category saved.'); if (ok) { setEdit(null); r.reload(); } };
  const move = async (i, d) => { const list = r.data.categories.map((c) => c.id); [list[i], list[i + d]] = [list[i + d], list[i]]; await act(() => adminApi.put('/categories/reorder', { order: list })); r.reload(); };
  const image = async (c, file) => { if (!file) return; const fd = new FormData(); fd.append('image', file); await act(() => adminApi.put(`/categories/${c.id}/image`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }), 'Image updated.'); r.reload(); };
  return (<><PageTitle title="Categories" sub="Create, reorder, deactivate or archive. Categories with history are archived, never deleted.">{canManage && <button className="btn-primary" onClick={() => setEdit({ name: '', description: '', icon: 'star', status: 'active' })}>New category</button>}</PageTitle>
    <Load r={r}><Tbl head={['#', 'Name', 'Slug', 'Status', 'Actions']}>{r.data?.categories.map((c, i) => (
      <tr key={c.id}><Td>{i + 1}</Td><Td><strong>{c.name}</strong><p className="text-xs text-ink/55">{c.description}</p></Td><Td>{c.slug}</Td><Td><Pill s={c.status} /></Td>
        <Td>{canManage ? <div className="flex flex-wrap gap-1.5">
          <button className="btn-ghost !min-h-[34px] !px-2.5" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button><button className="btn-ghost !min-h-[34px] !px-2.5" disabled={i === r.data.categories.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
          <button className="btn-ghost !min-h-[34px]" onClick={() => setEdit(c)}>Edit</button>
          {c.status !== 'archived' && <button className="btn-ghost !min-h-[34px]" onClick={async () => { await act(() => adminApi.patch(`/categories/${c.id}`, { status: c.status === 'active' ? 'inactive' : 'active' })); r.reload(); }}>{c.status === 'active' ? 'Deactivate' : 'Activate'}</button>}
          {c.status !== 'archived' && <button className="btn-ghost !min-h-[34px]" onClick={async () => { if (window.confirm(`Archive ${c.name}? It will disappear from voting but history is kept.`)) { await act(() => adminApi.patch(`/categories/${c.id}`, { status: 'archived' })); r.reload(); } }}>Archive</button>}
          {!c.hasHistoricalData && <button className="btn-ghost !min-h-[34px] text-brand-dark" onClick={async () => { if (window.confirm('Delete permanently?')) { await act(() => adminApi.delete(`/categories/${c.id}`), 'Deleted.'); r.reload(); } }}>Delete</button>}
          <label className="btn-ghost !min-h-[34px] cursor-pointer">Image<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => image(c, e.target.files[0])} /></label></div> : <span className="text-xs text-ink/50">View only</span>}</Td></tr>))}</Tbl></Load>
    <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? 'Edit category' : 'New category'}>{edit && <form onSubmit={save} className="space-y-3">
      <Field label="Name" id="cn"><input id="cn" className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></Field>
      <Field label="Description" id="cd"><textarea id="cd" className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={500} /></Field>
      <Field label="Icon" id="ci"><select id="ci" className="input" value={edit.icon} onChange={(e) => setEdit({ ...edit, icon: e.target.value })}>{['star', 'clapperboard', 'mic', 'sparkles', 'trophy', 'tv', 'laugh', 'camera'].map((i) => <option key={i}>{i}</option>)}</select></Field>
      <button className="btn-primary w-full">Save</button></form>}</Modal></>);
}

/* ------------------------------ Celebrities (with AI assistants) ------------------------------ */
function CelebrityForm({ initial, categories, states, onDone }) {
  const act = useAct(); const toast = useToast();
  const [f, setF] = useState(initial); const [photo, setPhoto] = useState(null); const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]); useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]); const [ai, setAi] = useState({ busy: '', note: '', dupes: null, seo: null });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const cat = categories.find((c) => c.id === f.categoryId);
  const run = async (name, fn) => { setAi((s) => ({ ...s, busy: name, note: '' })); try { return await fn(); } catch (e) { toast(errMsg(e), 'error'); return null; } finally { setAi((s) => ({ ...s, busy: '' })); } };
  const aiBio = () => run('bio', async () => { const r = await adminApi.post('/ai/biography', { name: f.name, category: cat?.name, facts: f.bio }); const d = r.data; setF((s) => ({ ...s, bio: d.data.bio, aiDrafted: true })); setAi((s) => ({ ...s, note: d.ai ? 'AI draft inserted. Review and edit before saving; it is not published until you save.' : d.message })); });
  const aiCat = () => run('cat', async () => { const d = (await adminApi.post('/ai/category', { name: f.name, details: f.bio })).data; const top = d.data.suggestions?.[0]; const match = categories.find((c) => c.slug === top?.slug); if (match) setF((s) => ({ ...s, categoryId: match.id })); setAi((s) => ({ ...s, note: top ? `Suggested: ${top.slug} (${top.confidence}) — ${top.reason}` : 'No suggestion.' })); });
  const dupes = () => run('dup', async () => { const m = (await adminApi.post('/ai/duplicates', { name: f.name })).data.data.matches; setAi((s) => ({ ...s, dupes: m })); });
  const seo = () => run('seo', async () => { const d = (await adminApi.post('/ai/seo', { name: f.name, category: cat?.name, bio: f.bio })).data.data; setAi((s) => ({ ...s, seo: d })); });
  const submit = async (e) => { e.preventDefault(); const body = { name: f.name, categoryId: f.categoryId, gender: f.gender, socialUrl: f.socialUrl || '', bio: f.bio, state: f.state || null, region: f.region || undefined, status: f.status, aiDrafted: f.aiDrafted || undefined };
    if (!f.gender) { toast('Choose Male, Female or Others.', 'error'); return; }
    const res = await act(() => (f.id ? adminApi.patch(`/celebrities/${f.id}`, body) : adminApi.post('/celebrities', body)), photo ? null : 'Celebrity saved.');
    if (!res) return;
    if (photo) { // the photo goes up right after the profile exists (new profiles get their id from the save)
      const id = f.id || res.data?.data?.id; const fd = new FormData(); fd.append('image', photo);
      const up = await act(() => adminApi.put(`/celebrities/${id}/image`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }), 'Celebrity and photo saved.');
      if (!up) { toast('Profile saved, but the photo did not upload. Open Edit to try again.', 'error'); }
    }
    onDone(); };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name" id="xn"><input id="xn" className="input" value={f.name} onChange={set('name')} required minLength={2} /></Field>
      <Field label="Category" id="xc"><select id="xc" className="input" value={f.categoryId} onChange={set('categoryId')} required><option value="">Select…</option>{categories.filter((c) => c.status !== 'archived').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <div><span className="label">Group</span><div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Gender group">{[['male', 'Male'], ['female', 'Female'], ['other', 'Others']].map(([g, l]) => <button type="button" key={g} role="radio" aria-checked={f.gender === g} className="chip" onClick={() => setF((x) => ({ ...x, gender: g }))}>{l}</button>)}</div></div>
      <div><span className="label">Photo</span><div className="flex items-center gap-3"><span className="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-sand">{(preview || f.image) && <img src={preview || f.image} alt="" className="h-full w-full object-cover" />}</span>
        <label className="btn-ghost cursor-pointer">{photo ? 'Choose another' : f.image ? 'Replace photo' : 'Upload photo'}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file && file.size > 5 * 1024 * 1024) { toast('Photo must be under 5 MB.', 'error'); return; } setPhoto(file || null); }} /></label></div>
        <p className="mt-1 text-xs text-ink/55">JPG, PNG or WebP, up to 5 MB. Uploaded when you save.</p></div>
      <Field label="Social profile link (private)" id="xl" hint="For checking identity. Only admins see this. It is never shown on the site."><input id="xl" type="url" inputMode="url" className="input" placeholder="https://instagram.com/…" value={f.socialUrl || ''} onChange={set('socialUrl')} maxLength={300} /></Field>
      <Field label="Biography" id="xb"><textarea id="xb" className="input min-h-[100px]" value={f.bio} onChange={set('bio')} maxLength={2000} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="State" id="xs"><StateSelect id="xs" states={states} value={f.state} onChange={(v) => setF({ ...f, state: v })} allLabel="None" /></Field><Field label="Region" id="xr"><input id="xr" className="input" value={f.region || ''} onChange={set('region')} /></Field></div>
      <Field label="Status" id="xt"><select id="xt" className="input" value={f.status} onChange={set('status')}><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></Field>
      <div className="rounded-2xl bg-sand/40 p-3"><p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide"><Sparkles className="h-3.5 w-3.5" />AI assistant (drafts only)</p>
        <div className="flex flex-wrap gap-2">{[['Draft bio', aiBio, 'bio'], ['Suggest category', aiCat, 'cat'], ['Check duplicates', dupes, 'dup'], ['SEO draft', seo, 'seo']].map(([l, fn, k]) => <button type="button" key={k} className="btn-ghost !min-h-[34px] !px-3" disabled={!f.name || ai.busy} onClick={fn}>{ai.busy === k ? '…' : l}</button>)}</div>
        {ai.note && <p className="mt-2 text-xs">{ai.note}</p>}
        {ai.dupes && <div className="mt-2 text-xs">{ai.dupes.length ? <><p className="font-semibold text-ink">Possible duplicates:</p><ul className="list-disc pl-4">{ai.dupes.map((d) => <li key={d.id}>{d.name} ({d.code}) — {Math.round(d.score * 100)}% match</li>)}</ul></> : 'No similar records found.'}</div>}
        {ai.seo && <div className="mt-2 space-y-0.5 text-xs"><p><strong>Title:</strong> {ai.seo.title}</p><p><strong>Description:</strong> {ai.seo.description}</p><p><strong>Keywords:</strong> {ai.seo.keywords?.join(', ')}</p></div>}
        <p className="mt-2 text-[11px] text-ink/60">AI never changes votes, payments or rankings. Nothing is saved until you press Save.</p></div>
      <button className="btn-primary w-full">Save celebrity</button>
    </form>
  );
}

export function Celebrities() {
  const act = useAct(); const { meta } = useAuth();
  const [q, setQ] = useState(''); const dq = useDebounced(q); const [page, setPage] = useState(1); const [edit, setEdit] = useState(null); const [fc, setFc] = useState(''); const [fg, setFg] = useState('');
  const cats = useAsync(() => unwrap(adminApi.get('/categories')), []);
  const r = useAsync(() => unwrap(adminApi.get('/celebrities', { params: { q: dq || undefined, category: fc || undefined, gender: fg || undefined, page, limit: 15 } })), [dq, fc, fg, page]);
  const image = async (c, file) => { if (!file) return; const fd = new FormData(); fd.append('image', file); await act(() => adminApi.put(`/celebrities/${c.id}/image`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }), 'Image updated.'); r.reload(); };
  return (<><PageTitle title="Celebrities" sub="Votes shown are valid confirmed votes in the current campaign."><button className="btn-primary" onClick={() => setEdit({ name: '', categoryId: '', gender: '', socialUrl: '', bio: '', state: '', status: 'active' })}>Add celebrity</button></PageTitle>
    <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_200px_140px]"><input className="input" placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search celebrities" />
      <select className="input" aria-label="Category" value={fc} onChange={(e) => { setFc(e.target.value); setPage(1); }}><option value="">All categories</option>{cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <select className="input" aria-label="Group" value={fg} onChange={(e) => { setFg(e.target.value); setPage(1); }}><option value="">All groups</option><option value="male">Male</option><option value="female">Female</option><option value="other">Others</option></select></div>
    <Load r={r}>{r.data?.items.length ? <><Tbl head={['Name', 'Category', 'State', 'Votes', 'Status', 'Actions']}>{r.data.items.map((c) => (
      <tr key={c.id}><Td><div className="flex items-center gap-2.5"><span className="h-10 w-8 shrink-0 overflow-hidden rounded bg-sand">{c.image && <img src={c.image} alt="" loading="lazy" className="h-full w-full object-cover" />}</span><div><strong>{c.name}</strong><p className="text-xs text-ink/50">{c.code}{c.aiDrafted ? ' · AI-drafted' : ''}</p></div></div></Td><Td>{c.category?.name}<p className="text-xs text-ink/50">{({ male: 'Male', female: 'Female', other: 'Others' })[c.gender] || 'Others'}</p></Td><Td>{c.state || '–'}</Td><Td>{fmtNum(c.currentCampaignVotes)}</Td><Td><Pill s={c.status} /></Td>
        <Td><div className="flex flex-wrap gap-1.5"><button className="btn-ghost !min-h-[34px]" onClick={() => setEdit({ ...c, categoryId: c.category?.id })}>Edit</button><label className="btn-ghost !min-h-[34px] cursor-pointer">{c.image ? 'Replace photo' : 'Upload photo'}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => image(c, e.target.files[0])} /></label></div></Td></tr>))}</Tbl><Pagination page={r.data.page} pages={r.data.pages} onChange={setPage} /></> : <EmptyState title="No celebrities" text="Add the first celebrity to get started." />}</Load>
    <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? 'Edit celebrity' : 'Add celebrity'} wide>{edit && cats.data && <CelebrityForm initial={edit} categories={cats.data.categories} states={meta?.states} onDone={() => { setEdit(null); r.reload(); }} />}</Modal></>);
}

/* ------------------------------ Campaigns ------------------------------ */
export function Campaigns() {
  const { admin } = useAuth(); const act = useAct();
  const r = useAsync(() => unwrap(adminApi.get('/campaigns')), []);
  const [view, setView] = useState(null);
  const sup = admin.role === 'superadmin'; const adm = admin.role !== 'moderator';
  const open = async (c) => { const d = await act(() => unwrap(adminApi.get(`/campaigns/${c.id}/results`))); if (d) setView({ ...d, c }); };
  const finalize = async (c) => { if (!window.confirm(`Finalize ${c.title}? Results become permanent snapshots.`)) return; await act(() => adminApi.post(`/campaigns/${c.id}/finalize`, {}), 'Campaign finalized.'); r.reload(); };
  const publish = async (c) => { await act(() => adminApi.post(`/campaigns/${c.id}/publish`), 'Winners published.'); r.reload(); };
  const correct = async (c, cat) => { const reason = window.prompt('Reason for correction (min 10 characters, audited):'); if (!reason || reason.trim().length < 10) return; await act(() => adminApi.post(`/campaigns/${c.id}/correct`, { categoryId: cat, reason: reason.trim() }), 'Correction published as a new revision.'); };
  return (<><PageTitle title="Campaigns" sub="Monthly campaigns run on IST. Finalizing writes immutable ranking snapshots.">{adm && <button className="btn-ghost" onClick={() => act(() => adminApi.post('/jobs/reconcile'), 'Reconciliation finished.')}>Run reconciliation</button>}</PageTitle>
    <Load r={r}><Tbl head={['Campaign', 'Status', 'Window (IST)', 'Valid votes', 'Actions']}>{r.data?.campaigns.map((c) => (
      <tr key={c.id}><Td><strong>{c.title}</strong></Td><Td><CampaignBadge campaign={c} />{c.published && <span className="badge ml-1 bg-sand text-ink">Published</span>}</Td><Td className="text-xs">{fmtIST(c.startsAt)}<br />{fmtIST(c.endsAt)}</Td><Td>{fmtNum(c.validVotes)}</Td>
        <Td><div className="flex flex-wrap gap-1.5"><button className="btn-ghost !min-h-[34px]" onClick={() => open(c)}>Results</button>
          {sup && c.status === 'closed' && <button className="btn-primary !min-h-[34px]" onClick={() => finalize(c)}>Finalize</button>}
          {adm && c.finalized && !c.published && <button className="btn-primary !min-h-[34px]" onClick={() => publish(c)}>Publish winners</button>}</div></Td></tr>))}</Tbl></Load>
    <Modal wide open={Boolean(view)} onClose={() => setView(null)} title={view ? `${view.campaign.title} — ${view.campaign.status === 'finalized' ? 'final' : 'provisional'} results` : ''}>{view && <div className="space-y-4">
      {view.openPaymentItems > 0 && <p className="rounded-xl bg-sand p-2 text-xs text-ink">{view.openPaymentItems} payment(s) still open or awaiting reconciliation.</p>}
      {view.results.map((x) => <div key={x.category.id}><div className="flex items-center justify-between"><h3 className="font-heading text-sm font-bold">{x.category.name} <span className="font-normal text-ink/55">({fmtNum(x.totalValidVotes)} votes)</span></h3>{sup && view.campaign.finalized && <button className="text-xs font-semibold text-brand" onClick={() => correct(view.c, x.category.id)}>Audited correction…</button>}</div>
        <ol className="mt-1 text-sm">{x.entries.slice(0, 5).map((e) => <li key={e.celebrityId} className="flex justify-between border-b border-brand/5 py-1"><span>#{e.rank} {e.name}</span><span>{fmtNum(e.votes)}</span></li>)}{!x.entries.length && <li className="text-xs text-ink/55">No entries.</li>}</ol></div>)}</div>}</Modal></>);
}

/* ------------------------------ Payments ------------------------------ */
export function Payments() {
  const { admin } = useAuth(); const act = useAct();
  const [f, setF] = useState({ status: '', campaign: '' }); const [page, setPage] = useState(1);
  const r = useAsync(() => unwrap(adminApi.get('/payments', { params: { status: f.status || undefined, campaign: f.campaign || undefined, page, limit: 20 } })), [f.status, f.campaign, page]);
  const refund = async (p) => { const reason = reasonPrompt('Refund reason (min 5 characters):'); if (!reason) return; await act(() => adminApi.post(`/payments/${p.id}/refund`, { reason }), 'Refund requested.'); r.reload(); };
  return (<><PageTitle title="Payments & receipts" sub="Payments can only become 'paid' through gateway verification. Nothing here can mark a payment as paid.">
    <div className="flex gap-2"><a className="btn-ghost" href={reportUrl('payments')}><Download className="h-4 w-4" />Payments CSV</a><a className="btn-ghost" href={reportUrl('votes')}><Download className="h-4 w-4" />Votes CSV</a></div></PageTitle>
    <div className="mb-3 grid max-w-xl grid-cols-2 gap-3"><select className="input" aria-label="Status" value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }}><option value="">All statuses</option>{['created', 'paid', 'failed', 'cancelled', 'expired', 'requires_reconciliation', 'refund_pending', 'refunded', 'refund_failed'].map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}</select>
      <input className="input" aria-label="Campaign (YYYY-MM)" placeholder="Campaign e.g. 2026-10" pattern="\d{4}-\d{2}" value={f.campaign} onChange={(e) => { setF({ ...f, campaign: e.target.value }); setPage(1); }} /></div>
    <Load r={r}>{r.data?.items.length ? <><Tbl head={['Date', 'User', 'Vote for', 'Amount', 'Status', 'Gateway ID', '']}>{r.data.items.map((p) => (
      <tr key={p.id}><Td className="text-xs">{fmtIST(p.createdAt)}</Td><Td>{p.user?.name}<p className="text-xs text-ink/50">{p.user?.email}</p></Td><Td>{p.celebrity}<p className="text-xs text-ink/50">{p.category} · {p.campaign}</p></Td><Td>{inr(p.amountInr)}</Td><Td><Pill s={p.status} />{p.reconciliationReason && <p className="mt-1 text-xs text-ink">{p.reconciliationReason.replaceAll('_', ' ')}</p>}</Td><Td className="break-all text-xs">{p.razorpayPaymentId || '–'}</Td>
        <Td>{admin.role === 'superadmin' && ['requires_reconciliation', 'refund_failed'].includes(p.status) && <button className="btn-ghost !min-h-[34px]" onClick={() => refund(p)}>Refund</button>}</Td></tr>))}</Tbl><Pagination page={r.data.page} pages={r.data.pages} onChange={setPage} /></> : <EmptyState title="No payments match" />}</Load></>);
}

/* ------------------------------ Users ------------------------------ */
export function Users() {
  const { admin } = useAuth(); const act = useAct();
  const [q, setQ] = useState(''); const dq = useDebounced(q); const [page, setPage] = useState(1); const [mk, setMk] = useState(false);
  const r = useAsync(() => unwrap(adminApi.get('/users', { params: { q: dq || undefined, page, limit: 20 } })), [dq, page]);
  const adm = admin.role !== 'moderator'; const sup = admin.role === 'superadmin';
  const [na, setNa] = useState({ name: '', email: '', password: '', role: 'moderator' });
  return (<><PageTitle title="Users" sub="Sensitive actions require a reason and are logged.">{sup && <button className="btn-primary" onClick={() => setMk(true)}>Add staff account</button>}</PageTitle>
    <input className="input mb-3 max-w-sm" placeholder="Search name or email…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search users" />
    <Load r={r}><Tbl head={['User', 'Role', 'State', 'Status', 'Actions']}>{r.data?.items.map((u) => (
      <tr key={u.id}><Td><strong>{u.name}</strong><p className="text-xs text-ink/50">{u.email}</p></Td><Td>{u.role}</Td><Td>{u.state || '–'}</Td><Td><Pill s={u.status} />{u.suspensionReason && <p className="text-xs text-ink/55">{u.suspensionReason}</p>}</Td>
        <Td><div className="flex flex-wrap gap-1.5">{adm && u.role === 'user' && (u.status === 'active' ? <button className="btn-ghost !min-h-[34px]" onClick={async () => { const reason = reasonPrompt('Suspension reason (min 5 characters):'); if (reason) { await act(() => adminApi.post(`/users/${u.id}/suspend`, { reason }), 'User suspended.'); r.reload(); } }}>Suspend</button> : <button className="btn-ghost !min-h-[34px]" onClick={async () => { await act(() => adminApi.post(`/users/${u.id}/unsuspend`), 'User reinstated.'); r.reload(); }}>Reinstate</button>)}
          {sup && u.role !== 'superadmin' && <select aria-label={`Role for ${u.name}`} className="input !min-h-[34px] !w-auto !py-1" value={u.role} onChange={async (e) => { await act(() => adminApi.patch(`/users/${u.id}/role`, { role: e.target.value }), 'Role updated.'); r.reload(); }}>{['user', 'moderator', 'admin'].map((x) => <option key={x}>{x}</option>)}</select>}</div></Td></tr>))}</Tbl><Pagination page={r.data?.page} pages={r.data?.pages} onChange={setPage} /></Load>
    <Modal open={mk} onClose={() => setMk(false)} title="Add staff account"><form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await act(() => adminApi.post('/admins', na), 'Account created.')) { setMk(false); r.reload(); } }}>
      <Field label="Name" id="sn"><input id="sn" className="input" value={na.name} onChange={(e) => setNa({ ...na, name: e.target.value })} required /></Field><Field label="Email" id="se"><input id="se" type="email" className="input" value={na.email} onChange={(e) => setNa({ ...na, email: e.target.value })} required /></Field>
      <Field label="Temporary password (10+ chars)" id="sp"><input id="sp" type="password" className="input" value={na.password} onChange={(e) => setNa({ ...na, password: e.target.value })} minLength={10} required /></Field>
      <Field label="Role" id="sr"><select id="sr" className="input" value={na.role} onChange={(e) => setNa({ ...na, role: e.target.value })}><option>moderator</option><option>admin</option></select></Field><button className="btn-primary w-full">Create</button></form></Modal></>);
}

function NominationForm({ categories, onDone }) {
  const act = useAct(); const toast = useToast();
  const [f, setF] = useState({ name: '', categoryId: '', gender: '', reason: '', socialUrl: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => { e.preventDefault(); if (!f.gender) { toast('Choose Male, Female or Others.', 'error'); return; }
    if (await act(() => adminApi.post('/nominations', { name: f.name, categoryId: f.categoryId, gender: f.gender, reason: f.reason, socialUrl: f.socialUrl }), 'Nomination added.')) onDone(); };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name" id="an"><input id="an" className="input" value={f.name} onChange={set('name')} required minLength={2} maxLength={120} /></Field>
      <Field label="Category" id="ac"><select id="ac" className="input" value={f.categoryId} onChange={set('categoryId')} required><option value="">Select…</option>{categories.filter((c) => c.status !== 'archived').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <div><span className="label">Group</span><div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Gender group">{[['male', 'Male'], ['female', 'Female'], ['other', 'Others']].map(([g, l]) => <button type="button" key={g} role="radio" aria-checked={f.gender === g} className="chip" onClick={() => setF((x) => ({ ...x, gender: g }))}>{l}</button>)}</div></div>
      <Field label="Social profile link (private)" id="al" hint="Only admins see this."><input id="al" type="url" inputMode="url" className="input" placeholder="https://instagram.com/…" value={f.socialUrl} onChange={set('socialUrl')} maxLength={300} /></Field>
      <Field label="Note (optional)" id="ar"><input id="ar" className="input" value={f.reason} onChange={set('reason')} maxLength={300} /></Field>
      <button className="btn-primary w-full">Add nomination</button>
    </form>
  );
}

/* ------------------------------ Nominations ------------------------------ */
export function Nominations() {
  const act = useAct(); const [status, setStatus] = useState('pending'); const [page, setPage] = useState(1);
  const r = useAsync(() => unwrap(adminApi.get('/nominations', { params: { status, page, limit: 15 } })), [status, page]);
  const [sum, setSum] = useState({}); const [add, setAdd] = useState(false);
  const cats = useAsync(() => unwrap(adminApi.get('/categories')), []);
  const review = async (n, decision) => { const note = decision === 'reject' ? window.prompt('Reason shown to the nominator (optional):') ?? undefined : undefined; if (await act(() => adminApi.post(`/nominations/${n.id}/review`, { decision, note }), `Nomination ${decision}d.`)) r.reload(); };
  const summarize = async (n) => { const d = await act(() => adminApi.post('/ai/nomination', { nominationId: n.id })); if (d?.data) setSum((s) => ({ ...s, [n.id]: d.data })); };
  return (<><PageTitle title="Nominations" sub="Approving creates an inactive profile. Add a photo and bio, then activate it."><button className="btn-primary" onClick={() => setAdd(true)}>Add nomination</button></PageTitle>
    <select className="input mb-3 max-w-[200px]" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>{['pending', 'approved', 'rejected', 'duplicate'].map((s) => <option key={s}>{s}</option>)}</select>
    <Load r={r}>{r.data?.items.length ? <div className="space-y-3">{r.data.items.map((n) => (
      <div key={n.id} className="card space-y-2 p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-heading font-bold">{n.name} <span className="font-normal text-ink/60">· {n.category} · {({ male: 'Male', female: 'Female', other: 'Others' })[n.gender] || 'Others'}{n.state ? ` · ${n.state}` : ''}{n.source === 'admin' ? ' · added by admin' : ''}</span></p><Pill s={n.status} /></div>
        {n.reason && <p className="text-ink/80">{n.reason}</p>}{n.socialUrl && <a href={n.socialUrl} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-xs text-brand">Social profile: {n.socialUrl}</a>}{n.links?.map((l) => <a key={l} href={l} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-xs text-brand">{l}</a>)}
        {n.possibleDuplicates?.length > 0 && <p className="rounded-lg bg-sand p-2 text-xs text-ink">Possible duplicates: {n.possibleDuplicates.map((d) => `${d.name} (${d.code})`).join(', ')}</p>}
        {sum[n.id] && <div className="rounded-lg bg-sand/40 p-2 text-xs"><p>{sum[n.id].summary}</p>{sum[n.id].missingFields?.length > 0 && <p className="mt-1 font-semibold">Missing: {sum[n.id].missingFields.join(', ')}</p>}</div>}
        {n.status === 'pending' && <div className="flex flex-wrap gap-2"><button className="btn-ghost !min-h-[34px]" onClick={() => summarize(n)}><Sparkles className="h-3.5 w-3.5" />AI summary</button><button className="btn-primary !min-h-[34px]" onClick={() => review(n, 'approve')}>Approve</button><button className="btn-ghost !min-h-[34px]" onClick={() => review(n, 'duplicate')}>Duplicate</button><button className="btn-ghost !min-h-[34px] text-brand-dark" onClick={() => review(n, 'reject')}>Reject</button></div>}</div>))}<Pagination page={r.data.page} pages={r.data.pages} onChange={setPage} /></div> : <EmptyState title={`No ${status} nominations`} />}</Load>
    <Modal open={add} onClose={() => setAdd(false)} title="Add nomination">{add && cats.data && <NominationForm categories={cats.data.categories} onDone={() => { setAdd(false); r.reload(); }} />}</Modal></>);
}

/* ------------------------------ Settings ------------------------------ */
export function Settings() {
  const { admin, reloadMeta } = useAuth(); const act = useAct(); const sup = admin.role === 'superadmin';
  const r = useAsync(() => unwrap(adminApi.get('/settings')), []);
  const [amt, setAmt] = useState(null); const [cust, setCust] = useState(null); const [msg, setMsg] = useState(''); const [ann, setAnn] = useState(''); const [bn, setBn] = useState({ title: '', subtitle: '' }); const [file, setFile] = useState(null);
  const [bc, setBc] = useState({ title: '', body: '' }); const [draft, setDraft] = useState(null);
  const s = r.data; const value = amt ?? s?.voteAmountInr ?? 0; const custom = cust ?? s?.allowCustomAmount ?? true;
  const genAnn = async (kind) => { const d = await act(() => adminApi.post('/ai/announcement', { kind, campaignTitle: 'Monthly campaign' }).then((x) => x.data)); if (d) { setDraft(d); setAnn(d.data.message); setBc({ title: d.data.notificationTitle, body: d.data.message }); } };
  return (<><PageTitle title="Settings" sub="Platform-wide configuration." /><Load r={r}>{s && <div className="grid gap-4 lg:grid-cols-2">
    <div className="card space-y-3 p-5"><h2 className="font-heading font-bold">Vote transaction amount</h2>
      <p className="text-xs text-ink/60">Whole rupees from ₹0 to ₹7 (currency fixed to INR). This is the default amount; ₹0 creates no payment order. Paid amounts need Razorpay configured and an amount your gateway account accepts (minimum ₹{s.minGatewayInr}).</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Amount in rupees">{[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <button key={n} role="radio" aria-checked={value === n} disabled={!sup} onClick={() => setAmt(n)} className={`min-h-[44px] min-w-[52px] rounded-xl px-3 text-sm font-bold ${value === n ? 'bg-ink text-paper' : 'bg-ink/[.06]'}`}>{n === 0 ? 'Free' : `₹${n}`}</button>)}</div>
      <label className="flex min-h-[44px] items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-[#8E2430]" disabled={!sup} checked={custom} onChange={(e) => setCust(e.target.checked)} /><span><strong>Let voters choose their own amount</strong><br /><span className="text-xs text-ink/60">Shows a − 7 + stepper (₹0 to ₹7) when voting, starting at the default above. Every vote counts the same.</span></span></label>
      {!s.razorpayConfigured && <p className="rounded-lg bg-sand p-2 text-xs text-ink">Razorpay keys are not configured on the server.</p>}
      {sup ? <button className="btn-primary" disabled={(amt === null || amt === s.voteAmountInr) && (cust === null || cust === s.allowCustomAmount)} onClick={async () => { if (await act(() => adminApi.patch('/settings', { voteAmountInr: value, allowCustomAmount: custom }), 'Amount settings updated.')) { setAmt(null); setCust(null); r.reload(); reloadMeta(); } }}>Save amount settings</button> : <p className="text-xs text-ink/55">Only a Super Admin can change this.</p>}</div>
    <div className="card space-y-3 p-5"><h2 className="font-heading font-bold">Announcements</h2>
      <div className="flex gap-2 text-xs"><span className="self-center text-ink/60">AI draft:</span>{['opening', 'closing', 'results'].map((k) => <button key={k} className="btn-ghost !min-h-[32px] !px-2.5" onClick={() => genAnn(k)}><Sparkles className="h-3 w-3" />{k}</button>)}</div>
      {draft && <p className="text-xs text-ink/60">{draft.ai ? 'AI draft — review before publishing.' : draft.message}</p>}
      <textarea className="input" aria-label="Announcement" maxLength={300} value={ann} onChange={(e) => setAnn(e.target.value)} placeholder="Banner message shown on top of every page" />
      <button className="btn-primary" disabled={ann.trim().length < 5} onClick={async () => { if (await act(() => adminApi.post('/announcements', { message: ann }), 'Announcement published.')) { setAnn(''); r.reload(); reloadMeta(); } }}>Publish announcement</button>
      <ul className="divide-y divide-line text-sm">{s.announcements.map((a) => <li key={a._id} className="flex items-center justify-between gap-2 py-2"><span>{a.message}</span><button className="text-xs font-semibold text-brand-dark" onClick={async () => { await act(() => adminApi.delete(`/announcements/${a._id}`)); r.reload(); reloadMeta(); }}>Remove</button></li>)}</ul></div>
    <div className="card space-y-3 p-5"><h2 className="font-heading font-bold">Notification to all users</h2><Field label="Title" id="bt"><input id="bt" className="input" value={bc.title} onChange={(e) => setBc({ ...bc, title: e.target.value })} maxLength={140} /></Field><Field label="Message" id="bb"><textarea id="bb" className="input" value={bc.body} onChange={(e) => setBc({ ...bc, body: e.target.value })} maxLength={600} /></Field>
      <button className="btn-primary" disabled={bc.title.trim().length < 3} onClick={async () => { if (await act(() => adminApi.post('/notifications', { title: bc.title, body: bc.body }), 'Notification sent.')) setBc({ title: '', body: '' }); }}>Send</button></div>
    <div className="card space-y-3 p-5"><h2 className="font-heading font-bold">Homepage banners</h2>
      <Field label="Title" id="hb"><input id="hb" className="input" value={bn.title} onChange={(e) => setBn({ ...bn, title: e.target.value })} /></Field><Field label="Image" id="hi"><input id="hi" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files[0])} className="text-sm" /></Field>
      <button className="btn-primary" disabled={bn.title.trim().length < 2} onClick={async () => { const fd = new FormData(); fd.append('title', bn.title); if (file) fd.append('image', file); if (await act(() => adminApi.post('/banners', fd, { headers: { 'Content-Type': 'multipart/form-data' } }), 'Banner added.')) { setBn({ title: '', subtitle: '' }); setFile(null); r.reload(); reloadMeta(); } }}>Add banner</button>
      <ul className="divide-y divide-line text-sm">{s.banners.map((b) => <li key={b._id} className="flex items-center justify-between py-2"><span>{b.title}</span><button className="text-xs font-semibold text-brand-dark" onClick={async () => { await act(() => adminApi.delete(`/banners/${b._id}`)); r.reload(); reloadMeta(); }}>Remove</button></li>)}</ul></div>
  </div>}</Load></>);
}

/* ------------------------------ Audit ------------------------------ */
export function Audit() {
  const [page, setPage] = useState(1); const [action, setAction] = useState(''); const da = useDebounced(action);
  const r = useAsync(() => unwrap(adminApi.get('/audit-logs', { params: { page, limit: 25, action: da || undefined } })), [page, da]);
  return (<><PageTitle title="Audit log" sub="Append-only record of privileged actions."><a className="btn-ghost" href={reportUrl('audit')}><Download className="h-4 w-4" />CSV</a></PageTitle>
    <input className="input mb-3 max-w-xs" placeholder="Filter by action prefix e.g. campaign" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Filter by action" />
    <Load r={r}>{r.data?.items.length ? <><Tbl head={['When (IST)', 'Action', 'By', 'Reason / details']}>{r.data.items.map((a) => <tr key={a.id}><Td className="text-xs">{fmtIST(a.at)}</Td><Td><strong>{a.action}</strong></Td><Td>{a.actor?.name || '–'}<p className="text-xs text-ink/50">{a.role}</p></Td><Td className="max-w-md break-words text-xs">{a.reason}{a.meta ? ` ${JSON.stringify(a.meta)}` : ''}</Td></tr>)}</Tbl><Pagination page={r.data.page} pages={r.data.pages} onChange={setPage} /></> : <EmptyState title="No entries" />}</Load></>);
}
