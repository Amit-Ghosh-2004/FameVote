import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Receipt, Search, Vote } from 'lucide-react';
import { api, unwrap } from '../lib/api';
import { useAsync, useDebounced, usePoll } from '../lib/hooks';
import { useAuth } from '../lib/AuthContext';
import { HeroPodium, HeroTimer } from '../components/Hero';
import { CategoryList, ResultsLink, NominateBand } from '../components/Sections';
import { CampaignBadge, SectionHead, Skeleton, Portrait } from '../components/ui';

const how = ({ total, lo, hi }) => [[Check, 'Join free', 'Sign in with email, phone or Google and pick your state.'], [Vote, 'Vote once per category', `Browse by Male, Female or Others. ${total} categories, one pick each, ₹${lo}–₹${hi} per vote.`], [Receipt, 'Keep your receipt', 'Every vote gets a receipt you can verify.']];

function QuickSearch() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const res = useAsync(() => (dq.length >= 2 ? unwrap(api.get('/celebrities', { params: { q: dq, limit: 6 } })) : Promise.resolve(null)), [dq]);
  return (
    <div className="relative z-10">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink/45" strokeWidth={1.75} aria-hidden="true" />
        <input type="search" enterKeyHint="search" className="input !min-h-[52px] !rounded-2xl !pl-12" placeholder="Find a celebrity" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search celebrities" />
      </div>
      {dq.length >= 2 && (
        <div className="absolute inset-x-0 mt-2 overflow-hidden rounded-2xl border border-line bg-surface shadow-lift">
          {res.loading ? <div className="p-4"><Skeleton className="h-12" /></div>
            : res.data?.items?.length ? res.data.items.map((c) => (
              <Link key={c.id} to={`/celebrity/${c.slug || c.id}`} className="flex min-h-[60px] items-center gap-3 border-b border-line px-4 py-2 last:border-0 active:bg-ink/[.03]">
                <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-sand"><Portrait src={c.image} name={c.name} sizes="48px" /></span>
                <span className="min-w-0"><span className="block truncate font-semibold">{c.name}</span><span className="block text-xs text-ink/55">{c.category?.name}</span></span>
              </Link>))
              : <div className="p-5 text-center text-[15px]"><p className="font-semibold">No one by that name yet</p><Link to="/nominate" className="btn-ghost mt-3">Nominate them</Link></div>}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { meta, user } = useAuth();
  const cats = useAsync(() => unwrap(api.get('/categories')), [], { key: 'categories', ttl: 300000 });
  const home = useAsync(() => unwrap(api.get('/rankings/home')), [], { key: 'rankings/home', ttl: 10000 });
  const me = useAsync(() => (user ? unwrap(api.get('/me/dashboard')) : Promise.resolve(null)), [user?.id], { key: `me/dashboard:${user?.id || 'guest'}`, ttl: 10000 });
  const [slug, setSlug] = useState(null);
  usePoll(home.refresh, 30000, !home.loading && !home.error);

  const previews = home.data?.previews || [];
  const active = previews.find((p) => p.category.slug === slug) || previews[0];
  const camp = meta?.campaign; const next = meta?.nextCampaign;
  const timer = camp ? (camp.status === 'active' ? { t: camp.endsAt, l: 'Voting closes in' } : camp.status === 'upcoming' ? { t: camp.startsAt, l: 'Voting opens in' } : next ? { t: next.startsAt, l: 'Next round opens in' } : null) : null;


  const remaining = new Set((me.data?.thisMonth?.categoriesRemaining || []).map((c) => c.id));
  const total = cats.data?.categories?.length || 8;
  const votedSlugs = new Set((cats.data?.categories || []).filter((c) => me.data && !remaining.has(c.id)).map((c) => c.slug));
  const votedCount = me.data ? total - remaining.size : 0;
  const [lo, hi] = meta?.amountRangeInr || [0, 7];
  const HOW = how({ total, lo, hi });

  return (
    <div>
      {/* Hero: the question, the deadline, and the podium you can vote on */}
      <section className="stage pb-8 pt-5 lg:pb-12 lg:pt-10" aria-labelledby="hero">
        <div className="container-x grid items-center gap-x-12 gap-y-5 lg:grid-cols-[1fr_minmax(0,430px)]">
          <div className="hero-in">
            <div className="flex flex-wrap items-center gap-2">
              {camp && <CampaignBadge campaign={camp} />}
              {timer && <div className="lg:hidden"><HeroTimer compact target={timer.t} serverTime={meta.serverTime} label={timer.l.replace('Voting c', 'C').replace('Next round o', 'O')} /></div>}
            </div>
            <h1 id="hero" className="mt-4 font-heading text-[clamp(32px,9.6vw,50px)] font-extrabold leading-[1.02] sm:text-6xl lg:text-[3.6rem]">
              <span className="block">Who should win</span><span className="text-glow block pb-1">this month?</span>
            </h1>
            <p className="mt-4 hidden max-w-md text-[17px] leading-snug text-ink/70 lg:block">One vote per category, a live leaderboard, and a receipt for every vote.</p>
            <div className="mt-6 hidden max-w-md lg:block">{timer ? <HeroTimer target={timer.t} serverTime={meta.serverTime} label={timer.l} /> : <Skeleton className="h-[96px]" />}</div>
            <p className="mt-4 hidden text-[13px] text-ink/60 lg:block">Free to join. You choose ₹{lo}–₹{hi} per vote.</p>
          </div>
          <div className="min-w-0 lg:rounded-3xl lg:border lg:border-line lg:bg-surface/50 lg:p-5 lg:backdrop-blur">
            <HeroPodium previews={previews} slug={active?.category.slug} onSlug={setSlug} loading={home.loading} />
          </div>
        </div>
      </section>

      {/* One slim strip for the person's own progress, or the reason to sign up */}
      <div className="container-x mt-2">
        {!user ? (
          <Link to="/register" className="flex min-h-[60px] items-center justify-between gap-3 rounded-2xl bg-brand px-4 py-3 text-on active:scale-[.99]">
            <span><span className="block font-heading text-[17px] font-extrabold leading-tight">Join free and vote in a minute</span><span className="block text-[13px] text-on/95">One vote per category, every month.</span></span>
            <ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true" />
          </Link>
        ) : me.data && (
          <Link to={!me.data.eligibility.stateSet ? '/dashboard/profile' : '/vote'} className="block rounded-2xl border border-line bg-surface p-4 active:scale-[.99]">
            <div className="flex items-center justify-between gap-3"><span className="font-heading text-[17px] font-extrabold">Your ballot</span><span className="text-sm text-ink/65"><b className="tnum text-ink">{votedCount}</b> of {total} voted</span></div>
            <div className="mt-2.5 flex gap-1" aria-hidden="true">{(cats.data?.categories || []).map((c) => <span key={c.id} className={`h-2 flex-1 rounded-full ${remaining.has(c.id) ? 'bg-ink/10' : 'bg-brand'}`} />)}</div>
            <p className="mt-2.5 flex items-center gap-1.5 text-[13px] text-ink/65">
              {!me.data.eligibility.stateSet ? 'Choose your state to start voting'
                : remaining.size > 0 && me.data.eligibility.votingOpen ? `${remaining.size} ${remaining.size === 1 ? 'category' : 'categories'} left this month`
                : 'You have voted in every category. Thank you!'}
            </p>
          </Link>
        )}
      </div>

      <div className="container-x mt-5"><QuickSearch /></div>

      {/* How it works, trust points folded in */}
      <section className="mt-8 py-2 text-ink" aria-labelledby="how">
        <div className="container-x">
          <h2 id="how" className="font-heading text-[clamp(22px,6vw,28px)] font-extrabold leading-[1.05]">How it works</h2>
          <ol className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {HOW.map(([I, t, d], i) => (
              <li key={t} className="flex items-start gap-3 p-3.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><I className="h-[18px] w-[18px]" aria-hidden="true" /></span>
                <span className="min-w-0"><span className="block text-[15.5px] font-bold leading-tight">{i + 1}. {t}</span><span className="mt-0.5 block text-[13.5px] leading-snug text-ink/65">{d}</span></span>
              </li>))}
          </ol>
        </div>
      </section>

      {/* One tap per category: who leads, and a way in */}
      <section className="container-x mt-8" aria-label="Vote by category">
        <SectionHead title="Vote by category" sub="Tap one to pick your favourite" to="/rankings" link="Rankings" />
        <CategoryList previews={previews} loading={home.loading} voted={votedSlugs} />
      </section>

      <ResultsLink />
      <NominateBand />
    </div>
  );
}
