import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { api, unwrap, fmtNum } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useAuth } from '../lib/AuthContext';
import { RankingList } from '../components/Overlay';
import { PageTitle, Podium, Skeleton, ErrorState, EmptyState, Portrait, StateSelect, Segmented, CategoryPicker, GENDER_LABEL } from '../components/ui';

export default function Winners() {
  const { meta, user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [cat, setCat] = useState(null);
  const [scope, setScope] = useState('national');
  const [state, setState] = useState(user?.state || '');
  const list = useAsync(() => unwrap(api.get('/winners')), [], { key: 'winners', ttl: 60000 });
  const key = sp.get('campaign') || list.data?.campaigns?.[0]?.key;
  const res = useAsync(() => (key ? unwrap(api.get('/winners', { params: { campaign: key } })) : Promise.resolve(null)), [key], { key: `winners:${key}`, ttl: 60000 });
  const d = res.data;
  const current = d?.national?.find((n) => n.category?.slug === cat) || d?.national?.[0];
  const rows = scope === 'national' ? current?.top : d?.state?.find((s) => s.state === state && s.category?.slug === current?.category?.slug)?.top;

  return (
    <div className="container-x pt-6">
      <PageTitle title="Winners" sub="Final results, kept permanently.">
        {list.data?.campaigns?.length > 0 && (
          <div className="relative w-full sm:w-auto">
            <select className="input appearance-none pr-10 sm:!w-auto" aria-label="Campaign" value={key || ''} onChange={(e) => setSp({ campaign: e.target.value })}>{list.data.campaigns.map((c) => <option key={c.key} value={c.key}>{c.title}</option>)}</select>
            <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/50" aria-hidden="true" />
          </div>)}
      </PageTitle>

      {list.loading || res.loading ? <div className="space-y-4"><Skeleton className="h-56" /><Skeleton className="h-72" /></div>
        : list.error || res.error ? <ErrorState message="Could not load winners." onRetry={() => { list.reload(); res.reload(); }} />
        : !list.data.campaigns.length ? <EmptyState title="No published results yet" text="Results appear here once a campaign closes and is finalized." />
        : d && (
          <div className="space-y-7">
            <section aria-label="Champions">
              <h2 className="mb-3 text-xl font-bold">Champions of {d.campaign.title.replace(' Campaign', '')}</h2>
              <div className="snap-row">
                {d.national.map((n) => {
                  const w = n.winners?.[0];
                  return (
                    <button key={n.category?.slug} onClick={() => { setCat(n.category?.slug); setScope('national'); }} className="w-[44vw] max-w-[190px] shrink-0 text-left transition active:scale-[.97] sm:w-44">
                      <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-sand">
                        {w ? <Portrait src={w.image} name={w.name} /> : <div className="grid h-full place-items-center text-sm text-ink/60">No votes</div>}
                      </div>
                      <p className="mt-2 truncate text-[13px] text-ink/65">{n.category?.name}</p>
                      <p className="truncate text-[15px] font-semibold leading-tight">{w?.name || '—'}</p>
                      {w && <p className="text-xs text-ink/60 tnum">{fmtNum(w.votes)} votes</p>}
                    </button>);
                })}
              </div>
            </section>

            <section aria-label="Full rankings">
              <div className="mb-5">
                <CategoryPicker active={current?.category?.slug} onSelect={setCat}
                  items={d.national.map((n) => ({ slug: n.category?.slug, name: n.category?.name, icon: n.category?.icon }))} />
              </div>
              <div className="mb-3 max-w-sm"><Segmented label="Scope" value={scope} onChange={setScope} options={[['national', 'India Top 15'], ['state', 'State Top 10']]} /></div>
              {scope === 'state' && <div className="mb-3 max-w-sm"><StateSelect id="ws" states={meta?.states} value={state} onChange={setState} allLabel="Choose a state" /></div>}
              {scope === 'national' && current?.top?.length > 0 && (
                <div className="stage mb-5 rounded-2xl px-3 pb-3 pt-4 sm:px-5 sm:pb-5"><Podium entries={current.top} /></div>)}
              {scope === 'national' && ['male', 'female', 'other'].some((g) => current?.byGender?.[g]?.length) && (
                <ul className="mb-4 grid gap-2 sm:grid-cols-3" aria-label="Winner in each group">
                  {['male', 'female', 'other'].map((g) => { const w = current.byGender[g]?.[0]; return w ? <li key={g} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-2.5"><span className="h-14 w-11 shrink-0 overflow-hidden rounded-xl bg-sand"><Portrait src={w.image} name={w.name} sizes="48px" /></span><span className="min-w-0"><span className="block text-xs text-ink/55">{GENDER_LABEL[g]} winner</span><span className="block truncate font-semibold">{w.name}</span></span></li> : null; })}
                </ul>)}
              <div className="border-y border-line">
                {scope === 'state' && !state ? <p className="py-8 text-center text-[15px] text-ink/60">Choose a state to see its Top 10.</p>
                  : rows?.length ? <RankingList entries={rows} limit={scope === 'national' ? 15 : 10} />
                  : <p className="py-8 text-center text-[15px] text-ink/60">No valid votes here in this campaign.</p>}
              </div>
              
            </section>
          </div>)}
    </div>
  );
}
