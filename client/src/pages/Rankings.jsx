import { useSearchParams, Link } from 'react-router-dom';
import { ChevronDown, ArrowRight } from 'lucide-react';
import { api, unwrap, fmtNum } from '../lib/api';
import { useAsync, usePoll } from '../lib/hooks';
import { useAuth } from '../lib/AuthContext';
import { SkeletonRows, ErrorState, StateSelect, Segmented, EmptyState, CategoryPicker, GenderTabs, Portrait, Podium, GENDER_LABEL } from '../components/ui';

const MEDAL = { 1: 'bg-brand text-on', 2: 'bg-ink/80 text-paper', 3: 'bg-sand text-ink ring-1 ring-ink/20' };

function Row({ e, max }) {
  const pct = e.votes ? Math.max(3, Math.round((e.votes / max) * 100)) : 0;
  const mv = e.movement;
  return (
    <li>
      <Link to={`/celebrity/${e.slug || e.celebrityId}`} className="flex min-h-[60px] items-center gap-3 py-2 active:bg-ink/[.03]">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full font-heading text-[15px] font-extrabold tabular-nums ${MEDAL[e.rank] || 'bg-ink/[.06] text-ink/80'}`}>{e.rank}</span>
        <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-sand"><Portrait src={e.image} name={e.name} sizes="48px" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold leading-tight">{e.name}</span>
          <span className="mt-1.5 block h-[4px] overflow-hidden rounded-full bg-ink/10"><span className={`block h-full rounded-full ${e.rank <= 3 ? 'bg-brand' : 'bg-ink/45'}`} style={{ width: `${pct}%` }} /></span>
        </span>
        <span className="w-[62px] shrink-0 text-right">
          <span className="block text-[15px] font-bold tabular-nums">{fmtNum(e.votes)}</span>
          {typeof mv === 'number' && mv !== 0 ? <span className={`text-[11px] font-semibold ${mv > 0 ? 'text-mint' : 'text-brand-dark'}`}>{mv > 0 ? '▲' : '▼'} {Math.abs(mv)}</span> : null}
        </span>
      </Link>
    </li>
  );
}

export default function Rankings() {
  const { meta, user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const cats = useAsync(() => unwrap(api.get('/categories')), [], { key: 'categories', ttl: 300000 });
  const camps = useAsync(() => unwrap(api.get('/campaigns')), [], { key: 'campaigns', ttl: 60000 });
  const category = sp.get('category') || cats.data?.categories?.[0]?.slug;
  const scope = sp.get('scope') === 'state' ? 'state' : 'national';
  const state = sp.get('state') || (scope === 'state' ? user?.state || '' : '');
  const campaign = sp.get('campaign') || 'current';
  const gender = ['male', 'female', 'other'].includes(sp.get('gender')) ? sp.get('gender') : '';
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };

  const r = useAsync(() => (category && (scope === 'national' || state) ? unwrap(api.get('/rankings', { params: { category, scope, state: scope === 'state' ? state : undefined, gender: gender || undefined, campaign } })) : Promise.resolve(null)), [category, scope, state, gender, campaign], { key: `rank:${category}:${scope}:${scope === 'state' ? state : ''}:${gender}:${campaign}`, ttl: campaign === 'current' ? 10000 : 120000 });
  usePoll(r.refresh, 30000, !r.loading && !r.error && r.data?.provisional);
  const d = r.data;
  const stateName = meta?.states?.find((s) => s.code === (d?.state || state))?.name;
  const past = camps.data?.campaigns?.filter((c) => c.key !== meta?.campaign?.key && c.status !== 'upcoming') || [];

  const cat = cats.data?.categories?.find((c) => c.slug === category);
  const entries = d?.entries || [];
  const max = Math.max(1, ...entries.map((e) => e.votes));
  const open = meta?.campaign?.status === 'active' && campaign === 'current';
  const voteLink = `/vote?category=${category || ''}${gender ? `&gender=${gender}` : ''}`;
  const title = d ? `${d.scope === 'national' ? 'India Top 15' : `${stateName || 'State'} Top 10`}${gender ? ` · ${GENDER_LABEL[gender]}` : ''}` : '';

  return (
    <>
      <div className="container-x pt-4">
        <div className="flex items-center justify-between gap-3"><h1 className="font-heading text-[28px] font-extrabold leading-none sm:text-4xl">Rankings</h1>{d?.provisional && <span className="badge bg-brand-soft text-brand-dark"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" aria-hidden="true" />Live</span>}</div>
        <CategoryPicker className="mt-3" loading={!cats.data} active={category} onSelect={(v) => { const n = new URLSearchParams(sp); n.set('category', v); n.delete('gender'); setSp(n, { replace: true }); }}
          items={cats.data?.categories?.map((c) => ({ slug: c.slug, name: c.name, icon: c.icon, count: c.celebrityCount }))} />
      </div>

      <div className="container-x pt-3">
        <Segmented label="Ranking scope" value={scope} onChange={(v) => set('scope', v === 'national' ? '' : v)} options={[['national', 'India Top 15'], ['state', 'My state Top 10']]} />
        <GenderTabs className="mt-3" label="Show" value={gender} counts={cat?.genderCounts} onChange={(g) => set('gender', g)} />
        {(scope === 'state' || past.length > 0) && (
          <div className={`mt-3 grid gap-3 ${scope === 'state' && past.length > 0 ? 'grid-cols-2' : ''}`}>
            {scope === 'state' && <div><label className="label" htmlFor="rs">State</label><StateSelect id="rs" states={meta?.states} value={state} onChange={(v) => set('state', v)} /></div>}
            {past.length > 0 && <div>
              <label className="label" htmlFor="rm">Month</label>
              <div className="relative">
                <select id="rm" className="input appearance-none pr-9" value={campaign} onChange={(e) => set('campaign', e.target.value === 'current' ? '' : e.target.value)}>
                  <option value="current">{meta?.campaign?.title?.replace(' Campaign', '') || 'This month'}</option>
                  {past.map((c) => <option key={c.key} value={c.key}>{c.title.replace(' Campaign', '')}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/50" aria-hidden="true" />
              </div>
            </div>}
          </div>)}
      </div>

      <div className="container-x pb-28 pt-5 lg:pb-10">
        {r.loading ? <SkeletonRows n={7} /> : r.error ? <ErrorState message="Could not load rankings." onRetry={r.reload} />
          : !d ? <EmptyState title="Choose a state" text="Pick a state or union territory to see its Top 10." />
          : (
            <>
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="font-heading text-[19px] font-extrabold">{title}</h2>
                <span className="shrink-0 text-[13px] text-ink/60 tabular-nums">{fmtNum(d.totalValidVotes)} votes · {d.provisional ? 'live' : 'final'}</span>
              </div>
              {entries.length ? (
                <>
                  {d.scope === 'national' ? <div className="mx-auto mb-3 max-w-[290px]"><Podium entries={entries} /></div> : null}
                  {(d.scope === 'national' ? entries.slice(3) : entries).length > 0 && <ol className="divide-y divide-line">{(d.scope === 'national' ? entries.slice(3) : entries).map((e) => <Row key={e.celebrityId} e={e} max={max} />)}</ol>}
                  <p className="mt-3 text-xs text-ink/55">Ties share a rank and are listed A to Z.</p>
                </>)
                : <EmptyState title="No votes here yet" text={d.scope === 'state' ? `No valid votes from ${stateName || 'this state'} yet.` : 'Be the first to vote in this group.'} action={open ? <Link to={voteLink} className="btn-primary mt-2">Vote now</Link> : null} />}
            </>)}
      </div>

      {open && entries.length > 0 && (
        <div className="pointer-events-none sticky bottom-[76px] z-30 px-4 lg:bottom-6 lg:flex lg:justify-center">
          <Link to={voteLink} className="btn-pop pointer-events-auto flex w-full !min-h-[48px] items-center justify-center gap-2 text-[15px] shadow-lift lg:w-auto lg:px-8">Vote in {cat?.name || 'this category'}<ArrowRight className="h-5 w-5" aria-hidden="true" /></Link>
        </div>)}
    </>
  );
}
