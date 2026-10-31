import { useState } from 'react';
import { Check, Clock, X } from 'lucide-react';
import { api, unwrap, errMsg } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/Toast';
import { CategoryIcon, PageTitle, Field, EmptyState, GENDER_LABEL } from '../components/ui';

const TONE = { pending: ['bg-sand text-ink', Clock], approved: ['bg-mint-soft text-mint', Check], rejected: ['bg-danger/10 text-danger', X], duplicate: ['bg-ink/[.07] text-ink/70', X] };

export default function Nominate() {
  const toast = useToast();
  const cats = useAsync(() => unwrap(api.get('/categories')), [], { key: 'categories', ttl: 300000 });
  const mine = useAsync(() => unwrap(api.get('/nominations/mine')), []);
  const blank = { name: '', categoryId: '', gender: '', reason: '' };
  const [f, setF] = useState(blank); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (!f.categoryId) return toast('Pick a category first.', 'error');
    if (!f.gender) return toast('Pick Male, Female or Others.', 'error');
    setBusy(true);
    try {
      await api.post('/nominations', { name: f.name, categoryId: f.categoryId, gender: f.gender, reason: f.reason.trim() || undefined });
      toast('Nomination sent for review. Thank you!', 'success'); setF(blank); mine.reload();
    } catch (x) { toast(errMsg(x), 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="container-x grid max-w-4xl gap-8 pt-6 lg:grid-cols-[1.2fr_1fr]">
      <div>
        <PageTitle title="Nominate someone" sub="Know a star we are missing? We check every nomination before it goes live." />
        <form onSubmit={submit} className="space-y-5 rounded-2xl bg-surface p-5 border border-line">
          <Field label="Celebrity name" id="nn"><input id="nn" className="input" value={f.name} onChange={set('name')} minLength={2} maxLength={120} required /></Field>
          <div>
            <span className="label">Category</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
              {cats.data?.categories?.map((c) => <button type="button" key={c.id} role="radio" aria-checked={f.categoryId === c.id} aria-selected={f.categoryId === c.id} className="chip" onClick={() => setF((s) => ({ ...s, categoryId: c.id }))}><CategoryIcon name={c.icon} className="h-4 w-4" />{c.name}</button>)}
              {!cats.data && <div className="skeleton h-10 w-full" />}
            </div>
          </div>
          <div>
            <span className="label">They are</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Gender">
              {['male', 'female', 'other'].map((g) => <button type="button" key={g} role="radio" aria-checked={f.gender === g} className="chip" onClick={() => setF((s) => ({ ...s, gender: g }))}>{GENDER_LABEL[g]}</button>)}
            </div>
          </div>
          <Field label="Why them? (optional)" id="nr"><input id="nr" className="input" value={f.reason} onChange={set('reason')} maxLength={300} placeholder="One line is plenty" /></Field>
          <button className="btn-pop w-full !min-h-[56px] text-[16px]" disabled={busy}>{busy ? 'Sending…' : 'Send nomination'}</button>
        </form>
      </div>
      <div>
        <h2 className="mb-3 text-xl font-bold">Your nominations</h2>
        {mine.data?.nominations?.length
          ? <ul className="divide-y divide-line rounded-2xl bg-surface px-4 border border-line">{mine.data.nominations.map((n) => { const [cls, I] = TONE[n.status] || TONE.pending; return <li key={n.id} className="flex min-h-[64px] items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate font-semibold">{n.name}</p><p className="text-xs text-ink/55">{n.category}</p></div><span className={`badge ${cls}`}><I className="h-3 w-3" aria-hidden="true" />{n.status}</span></li>; })}</ul>
          : <EmptyState title="Nothing yet" text="Nominations you send will show up here with their status." />}
      </div>
    </div>
  );
}
