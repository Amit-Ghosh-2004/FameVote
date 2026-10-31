import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, LayoutGrid, Layers, Search, SlidersHorizontal, X } from 'lucide-react';
import { api, unwrap } from '../lib/api';
import { useAsync, useDebounced } from '../lib/hooks';
import { useAuth } from '../lib/AuthContext';
import { CelebrityCard, SkeletonGrid, ErrorState, EmptyState, Pagination, StateSelect, CategoryPicker, GenderTabs } from '../components/ui';
import SwipeDeck from '../components/SwipeDeck';
import VoteDialog from '../components/VoteDialog';

export default function Vote() {
  const { meta, user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(''); const dq = useDebounced(q, 300);
  const [state, setState] = useState(''); const [gender, setGender] = useState(() => (['male', 'female', 'other'].includes(sp.get('gender')) ? sp.get('gender') : '')); const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(false);
  const [pick, setPick] = useState(null);
  const [mode, setMode] = useState(() => { let m = null; try { m = localStorage.getItem('fv-vote-mode'); } catch { /* private mode */ } if (m === 'grid' || m === 'swipe') return m; return typeof window !== 'undefined' && window.innerWidth < 640 ? 'swipe' : 'grid'; });
  const changeMode = (m) => { setMode(m); try { localStorage.setItem('fv-vote-mode', m); } catch { /* private mode */ } };
  const cats = useAsync(() => unwrap(api.get('/categories')), [], { key: 'categories', ttl: 300000 });
  const slug = sp.get('category') || cats.data?.categories?.[0]?.slug;
  const category = cats.data?.categories?.find((c) => c.slug === slug);
  const list = useAsync(() => (slug ? unwrap(api.get('/celebrities', { params: { category: slug, q: dq || undefined, state: state || undefined, gender: gender || undefined, page, limit: 12 } })).then((d) => ({ ...d, forSlug: slug })) : Promise.resolve(null)), [slug, dq, state, gender, page], { key: `celebs:${slug}:${dq}:${state}:${gender}:${page}`, ttl: 20000, keepPrevious: true });
  const mine = useAsync(() => (user ? unwrap(api.get('/votes/mine')) : Promise.resolve(null)), [user?.id], { key: `mine:${user?.id || 'guest'}`, ttl: 15000 });
  const camp = meta?.campaign;
  const thisMonth = mine.data?.votes?.filter((v) => v.campaign?.key === camp?.key && v.status === 'confirmed') || [];
  const votedHere = thisMonth.find((v) => v.category?.slug === slug);
  const votedSlugs = new Set(thisMonth.map((v) => v.category?.slug));
  const closed = camp && camp.status !== 'active';
  // The next category after this one that the voter has not voted in yet (wraps around), offered after a confirmed vote.
  const cl = cats.data?.categories || [];
  const at = cl.findIndex((c) => c.slug === slug);
  const nextCategory = cl.length > 1 ? [...cl.slice(at + 1), ...cl.slice(0, Math.max(at, 0))].find((c) => c.slug !== slug && !votedSlugs.has(c.slug)) : undefined;

  const swipe = mode === 'swipe';
  const reset = () => { setPage(1); setQ(''); setState(''); setGender(''); };

  return (
    <>
      {/* In swipe mode on a phone the page is exactly one screen: filters on top, card in the middle, buttons at the bottom. */}
      <div className={`container-x flex flex-col pt-2 ${swipe ? 'h-[calc(100dvh-64px-92px-env(safe-area-inset-bottom))] min-h-[440px] sm:h-[calc(100dvh-72px-92px-env(safe-area-inset-bottom))] lg:h-[calc(100dvh-84px)] lg:min-h-[560px] lg:pb-4' : ''}`}>
        <h1 className={`mb-1 hidden text-4xl font-bold leading-none lg:mb-3 lg:mt-3 ${swipe ? '' : 'lg:block'}`}>Vote</h1>
        <h1 className={`sr-only ${swipe ? '' : 'lg:hidden'}`}>Vote</h1>
        <CategoryPicker className="mt-1" loading={!cats.data} active={slug} onSelect={(v) => { if (v === slug) return; setSp({ category: v }, { replace: true }); reset(); }}
          items={cats.data?.categories?.map((c) => ({ slug: c.slug, name: c.name, icon: c.icon, count: c.celebrityCount, done: votedSlugs.has(c.slug) }))} />

        <div className="mt-2 flex items-center gap-3">
          <div className="min-w-0 flex-1"><GenderTabs className="!mx-0 !px-0" label="Show" value={gender} counts={category?.genderCounts} onChange={(g) => { setGender(g); setPage(1); }} /></div>
          <div role="radiogroup" aria-label="Browse style" className="dock !w-auto shrink-0">
            {[['swipe', Layers, 'Swipe'], ['grid', LayoutGrid, 'Grid']].map(([v, I, l]) => (
              <button key={v} type="button" role="radio" aria-checked={mode === v} aria-label={l} onClick={() => changeMode(v)} className="dock-btn !min-h-[36px] !w-10 !px-0"><I className="h-[18px] w-[18px]" aria-hidden="true" /></button>
            ))}
          </div>
        </div>

        {!swipe && (
          <>
            <div className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink/45" aria-hidden="true" />
                <input type="search" enterKeyHint="search" className="input !pl-10 !pr-10" placeholder={`Search ${category?.name || 'celebrities'}`} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search celebrities" />
                {q && <button className="absolute right-1.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-ink/50" aria-label="Clear search" onClick={() => setQ('')}><X className="h-4 w-4" /></button>}
              </div>
              <button className="btn-ghost !px-4" aria-expanded={filters} aria-label="Filter by state" onClick={() => setFilters((f) => !f)}><SlidersHorizontal className="h-5 w-5" />{state && <span className="h-2 w-2 rounded-full bg-brand" />}</button>
            </div>
            {filters && <div className="mt-2"><StateSelect states={meta?.states} value={state} onChange={(v) => { setState(v); setPage(1); }} allLabel="Celebrities from any state" id="vs" /></div>}
          </>
        )}

        {votedHere && <div className="mt-3 flex items-center gap-3 rounded-2xl bg-ink/[.06] px-4 py-3 text-[14.5px]" role="status"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-on"><Check className="h-4 w-4" strokeWidth={3} /></span><p>You voted for <strong>{votedHere.celebrity?.name}</strong> here. Votes can't be changed.</p></div>}
        {closed && <div className="mt-3 rounded-2xl bg-ink/[.06] px-4 py-3 text-[14.5px] text-ink" role="status">{camp.status === 'upcoming' ? 'Voting opens soon. You can look around now.' : 'Voting is closed. Results come on the last day of the month. A new round opens on the 1st.'}</div>}

        <div className={`${swipe ? 'mt-3 flex min-h-0 flex-1 flex-col' : 'mt-4'}`}>
          {list.loading || (list.data && list.data.forSlug !== slug) ? (swipe ? <div className="skeleton min-h-[300px] flex-1 !rounded-2xl" aria-busy="true" /> : <SkeletonGrid n={8} />) : list.error ? <ErrorState message="Could not load celebrities." onRetry={list.reload} />
            : !list.data?.items?.length ? <EmptyState title="No one matches" text={q || state || gender ? 'Clear the search or filters to see everyone.' : 'No one is listed here yet.'} action={(q || state || gender) ? <button className="btn-ghost mt-2" onClick={() => { setQ(''); setState(''); setGender(''); }}>Clear filters</button> : <Link to="/nominate" className="btn-ghost mt-2">Nominate someone</Link>} />
              : swipe
                ? <SwipeDeck items={list.data.items} votedId={votedHere?.celebrity?.id} disabled={(Boolean(votedHere)) || closed} onVote={setPick} />
                : <div aria-busy={list.fetching} className={`grid grid-cols-2 gap-x-3 gap-y-6 transition-opacity sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 ${list.fetching ? 'pointer-events-none opacity-60' : ''}`}>
                  {list.data.items.map((c) => <CelebrityCard key={c.id} celeb={c} voted={votedHere?.celebrity?.id === c.id} disabled={(Boolean(votedHere) && votedHere.celebrity?.id !== c.id) || closed} onVote={setPick} />)}
                </div>}
          {!swipe && <Pagination page={list.data?.page} pages={list.data?.pages} onChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
        </div>
      </div>
      <VoteDialog celeb={pick} category={category} onClose={() => setPick(null)} onVoted={() => mine.reload()} nextCategory={user ? nextCategory : undefined} onNext={(s2) => { setSp({ category: s2 }, { replace: true }); reset(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
    </>
  );
}
