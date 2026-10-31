import { useSearchParams, Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { api, unwrap, fmtNum } from '../lib/api';
import { useAsync, usePoll } from '../lib/hooks';
import { useAuth } from '../lib/AuthContext';
import { Skeleton, SkeletonRows, ErrorState, StateSelect, Segmented, EmptyState, CategoryPicker, GenderTabs, Portrait, Podium, GENDER_LABEL } from '../components/ui';

function Row({ e, max }) {
  const pct = e.votes ? Math.max(3, Math.round((e.votes / max) * 100)) : 0;
  const mv = e.movement;
  return (
    <li>
      <Link to={`/celebrity/${e.slug || e.celebrityId}`} className="card flex min-h-[72px] items-center gap-3 p-2.5 pr-3.5 transition hover:border-brand/40 active:scale-[.99]">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink/[.08] text-[15px] font-extrabold tabular-nums">{e.rank}</span>
        <span className="h-14 w-11 shrink-0 overflow-hidden rounded-xl bg-sand"><Portrait src={e.image} name={e.name} sizes="48px" /></span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block break-words text-[15px] font-semibold leading-tight">{e.name}</span>
          <span className="mt-2 block h-[4px] overflow-hidden rounded-full bg-ink/10"><span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></span>
        </span>
        <span className="min-w-[56px] shrink-0 text-right">
          <span className="block text-[15px] font-bold tabular-nums">{fmtNum(e.votes)}</span>
          {typeof mv === 'number' && mv !== 0 ? <span className={`text-[11px] font-semibold ${mv > 0 ? 'text-mint' : 'text-ink/55'}`}>{mv > 0 ? '▲' : '▼'} {Math.abs(mv)}</span> : <span className="text-[11px] text-ink/50">votes</span>}
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

  const r = useAsync(() => (category && (scope === 'national' || state) ? unwrap(api.get('/rankings', { params: { category, scope, state: scope === 'state' ? state : undefined, gender: gender || undefined, campaign } })) : Promise.resolve(null)), [category, scope, state, gender, campaign], { key: `rank:${category}:${scope}:${scope === 'state' ? state : ''}:${gender}:${campaign}`, ttl: campaign === 'current' ? 10000 : 120000 });  usePoll(r.refresh, 30000, !r.loading && !r.error && r.data?.provisional);
  const d = r.data;
  const stateName = meta?.states?.find((s) => s.code === (d?.state || state))?.name;
  const past = camps.data?.campaigns?.filter((c) => c.key !== meta?.campaign?.key && c.status !== 'upcoming') || [];

  const cat = cats.data?.categories?.find((c) => c.slug === category);
  const entries = d?.entries || [];
  const max = Math.max(1, ...entries.map((e) => e.votes));
  const open = meta?.campaign?.status === 'active' && campaign === 'current';
  const voteLink = `/vote?category=${category || ''}${gender ? `&gender=${gender}` : ''}`;
  const title = d ? `${d.scope === 'national' ? 'India Top 15' : `${stateName || 'State'} Top 10`}${gender ? ` · ${GENDER_LABEL[gender]}` : ''}` : '';
  const rest = d?.scope === 'national' ? entries.slice(3) : entries;

  return (
    <div className="container-x pb-10 pt-3 lg:pt-8">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="text-[28px] font-extrabold leading-none lg:text-5xl">The <span className="serif-accent">rankings</span></h1>
        <Segmented label="Ranking scope" value={scope} onChange={(v) => set('scope', v === 'national' ? '' : v)} options={[['national', 'All India'], ['state', 'My state']]} wide />
      </div>

      <CategoryPicker className="mt-3" loading={!cats.data} active={category} onSelect={(v) => { const n = new URLSearchParams(sp); n.set('category', v); n.delete('gender'); setSp(n, { replace: true }); }}
        items={cats.data?.categories?.map((c) => ({ slug: c.slug, name: c.name, icon: c.icon, count: c.celebrityCount }))} />

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <GenderTabs label="Show" value={gender} counts={cat?.genderCounts} onChange={(g) => set('gender', g)} />
        {scope === 'state' && <div className="w-full sm:w-64"><StateSelect id="rs" states={meta?.states} value={state} onChange={(v) => set('state', v)} /></div>}
        {past.length > 0 && (
          <select id="rm" aria-label="Month" className="input !min-h-[40px] w-auto !py-1.5 text-[14px]" value={campaign} onChange={(e) => set('campaign', e.target.value === 'current' ? '' : e.target.value)}>
            <option value="current">{meta?.campaign?.title?.replace(' Campaign', '') || 'This month'}</option>
            {past.map((c) => <option key={c.key} value={c.key}>{c.title.replace(' Campaign', '')}</option>)}
          </select>)}
      </div>

      <div className="mt-3 grid gap-x-12 gap-y-6 lg:mt-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
        {/* The plinth: the podium is the first thing on a phone, below four compact controls. */}
        <section className="stage rounded-[28px] px-3 pb-4 pt-6 sm:px-5 sm:pb-5 lg:sticky lg:top-24" aria-label="Rankings podium">
          {r.loading ? <Skeleton className="h-[290px] w-full" />
            : r.error ? <p role="alert" className="p-5 text-center text-[15px]">Could not load rankings. <button className="font-semibold underline" onClick={r.reload}>Try again</button></p>
            : !d ? <p className="p-5 text-center text-[15px]">Choose a state to see its top 10.</p>
            : entries.length ? <Podium entries={entries} />
            : <p className="p-5 text-center text-[15px]">{d.scope === 'state' ? `No votes from ${stateName || 'this state'} yet.` : 'No votes yet. Be the first.'}</p>}
          {d && (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
              <p className="min-w-0 text-[13px] leading-snug text-ink/70"><span className="block truncate">{title}</span><span><span className="tabular-nums font-semibold text-ink">{fmtNum(d.totalValidVotes)}</span> votes · {d.provisional ? 'Live' : 'Final'}</span></p>
              {open && <Link to={voteLink} className="btn-pop !min-h-[46px] shrink-0 !px-4"><span className="min-[400px]:hidden">Vote</span><span className="hidden min-[400px]:inline">Vote in {cat?.name || 'this category'}</span><ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
            </div>)}
        </section>

        <div>
          {r.loading ? <div className="space-y-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[72px] !rounded-3xl" />)}</div> : r.error ? <ErrorState message="Could not load rankings." onRetry={r.reload} />
            : d && entries.length === 0 ? <EmptyState title="Nothing to rank yet" text="Rankings appear as soon as votes come in." action={open ? <Link to={voteLink} className="btn-pop mt-2">Vote now</Link> : null} />
            : rest.length > 0 && (
              <>
                <h2 className="mb-3 text-[19px] font-extrabold">{d.scope === 'national' ? 'Ranks 4 to 15' : `Top ${entries.length}`}</h2>
                <ol className="space-y-2">{rest.map((e) => <Row key={e.celebrityId} e={e} max={max} />)}</ol>
                <p className="mt-3 text-xs text-ink/60">Ties share a rank and are listed A to Z.</p>
              </>)}
        </div>
      </div>
    </div>
  );
}
