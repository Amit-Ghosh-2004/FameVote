import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Search, SlidersHorizontal, X } from 'lucide-react';
import { api, unwrap } from '../lib/api';
import { useAsync, useDebounced } from '../lib/hooks';
import { useAuth } from '../lib/AuthContext';
import { CelebrityCard, SkeletonGrid, ErrorState, EmptyState, Pagination, StateSelect, Segmented, CategoryPicker, GenderTabs } from '../components/ui';
import SwipeDeck from '../components/SwipeDeck';
import VoteDialog from '../components/VoteDialog';

export default function Vote() {
  const { meta, user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(''); const dq = useDebounced(q, 300);
  const [state, setState] = useState(''); const [gender, setGender] = useState(() => (['male', 'female', 'other'].includes(sp.get('gender')) ? sp.get('gender') : '')); const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(false);
  const [pick, setPick] = useState(null);
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('fv-vote-mode') || 'grid'; } catch { return 'grid'; } });
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

  return (
    <>
      <div className="container-x pt-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-heading text-[28px] font-extrabold leading-none sm:text-4xl">Vote</h1>
          <div className="w-44"><Segmented label="Browse style" value={mode} onChange={changeMode} options={[['grid', 'Grid'], ['swipe', 'Swipe']]} /></div>
        </div>
        <CategoryPicker className="mt-3" loading={!cats.data} active={slug} onSelect={(v) => { if (v === slug) return; setSp({ category: v }, { replace: true }); setPage(1); setQ(''); setState(''); setGender(''); }}
          items={cats.data?.categories?.map((c) => ({ slug: c.slug, name: c.name, icon: c.icon, count: c.celebrityCount, done: votedSlugs.has(c.slug) }))} />
      </div>

      <div className="container-x pt-4">
        <GenderTabs className="mb-3" label="Show" value={gender} counts={category?.genderCounts} onChange={(g) => { setGender(g); setPage(1); }} />
        <div className={`mb-3 gap-2 ${mode === 'swipe' ? 'hidden' : 'flex'}`}>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink/45" aria-hidden="true" />
            <input type="search" enterKeyHint="search" className="input !pl-12 !pr-10" placeholder={`Search ${category?.name || 'celebrities'}`} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search celebrities" />
            {q && <button className="absolute right-1.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-ink/50" aria-label="Clear search" onClick={() => setQ('')}><X className="h-4 w-4" /></button>}
          </div>
          <button className="btn-ghost !px-4" aria-expanded={filters} aria-label="Filter by state" onClick={() => setFilters((f) => !f)}><SlidersHorizontal className="h-5 w-5" />{state && <span className="h-2 w-2 rounded-full bg-brand" />}</button>
        </div>
        {filters && <div className="mb-3"><StateSelect states={meta?.states} value={state} onChange={(v) => { setState(v); setPage(1); }} allLabel="Celebrities from any state" id="vs" /></div>}

        {votedHere && <div className="mb-4 flex items-start gap-3 rounded-xl bg-brand-soft p-4 text-[15px]" role="status"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand text-on"><Check className="h-4 w-4" strokeWidth={3} /></span><p>You voted for <strong>{votedHere.celebrity?.name}</strong> in this category. A confirmed vote cannot be changed.</p></div>}
        {closed && <div className="mb-4 rounded-2xl bg-sand p-4 text-[15px] text-ink" role="status">{camp.status === 'upcoming' ? 'Voting opens soon. You can browse the lineup now.' : 'Voting is closed. Results are final on the last day of the month; the next round opens on the 1st.'}</div>}

        {list.loading || (list.data && list.data.forSlug !== slug) ? <SkeletonGrid n={8} /> : list.error ? <ErrorState message="Could not load celebrities." onRetry={list.reload} />
          : !list.data?.items?.length ? <EmptyState title="No one matches" text={q || state || gender ? 'Clear the search or filters to see everyone.' : 'No celebrities are listed here yet.'} action={(q || state || gender) ? <button className="btn-ghost mt-2" onClick={() => { setQ(''); setState(''); setGender(''); }}>Clear filters</button> : <Link to="/nominate" className="btn-ghost mt-2">Nominate someone</Link>} />
          : mode === 'swipe'
            ? <SwipeDeck items={list.data.items} votedId={votedHere?.celebrity?.id} disabled={(Boolean(votedHere)) || closed} onVote={setPick} />
            : <div aria-busy={list.fetching} className={`grid grid-cols-2 gap-x-3 gap-y-6 transition-opacity sm:grid-cols-3 lg:grid-cols-4 ${list.fetching ? 'pointer-events-none opacity-60' : ''}`}>
              {list.data.items.map((c) => <CelebrityCard key={c.id} celeb={c} voted={votedHere?.celebrity?.id === c.id} disabled={(Boolean(votedHere) && votedHere.celebrity?.id !== c.id) || closed} onVote={setPick} />)}
            </div>}
        <Pagination page={list.data?.page} pages={list.data?.pages} onChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
      </div>
      <VoteDialog celeb={pick} category={category} onClose={() => setPick(null)} onVoted={() => mine.reload()} nextCategory={user ? nextCategory : undefined} onNext={(s2) => { setSp({ category: s2 }, { replace: true }); setPage(1); setQ(''); setState(''); setGender(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
    </>
  );
}
