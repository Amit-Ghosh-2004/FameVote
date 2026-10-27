import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Heart, MapPin, Share2 } from 'lucide-react';
import { motion } from 'motion/react';
import { haptic, shareLink } from '../lib/fx';
import { api, unwrap, fmtNum, errMsg } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useDocTitle } from '../lib/title';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/Toast';
import { Portrait, Skeleton, ErrorState, CampaignBadge, CountUp, GENDER_LABEL } from '../components/ui';
import VoteDialog from '../components/VoteDialog';

export default function Celebrity() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { user, meta } = useAuth();
  const toast = useToast();
  const [pick, setPick] = useState(null);
  const [fav, setFav] = useState(null);
  const r = useAsync(() => unwrap(api.get(`/celebrities/${slug}`)), [slug, user?.id], { key: `celeb:${slug}:${user?.id || 'guest'}`, ttl: 15000 });
  useDocTitle(r.data?.celebrity?.name);
  const catSlug = r.data?.celebrity?.category?.slug;
  const board = useAsync(() => (catSlug ? unwrap(api.get('/rankings', { params: { category: catSlug, scope: 'national', campaign: 'current' } })) : Promise.resolve(null)), [catSlug], { key: `rank:${catSlug}:national::current`, ttl: 10000 });
  if (r.loading) return <div className="container-x space-y-4 py-5"><Skeleton className="aspect-[4/5] max-h-[60dvh] w-full" /><Skeleton className="h-8 w-2/3" /><Skeleton className="h-20" /></div>;
  if (r.error) return <div className="container-x py-8"><ErrorState message={r.error?.response?.status === 404 ? 'This celebrity was not found. They may have been removed.' : 'Could not load this profile.'} onRetry={r.reload} /></div>;
  const { celebrity: c, standing: s, campaign, history } = r.data;
  const isFav = fav ?? r.data.isFavorite;
  const stateName = meta?.states?.find((x) => x.code === c.state)?.name;
  const toggle = async () => {
    if (!user) return toast('Log in to save favourites.', 'info');
    setFav(!isFav); haptic(10); // optimistic: roll back if the server says no
    try { if (isFav) await api.delete(`/me/favorites/${c.id}`); else await api.post('/me/favorites', { celebrityId: c.id }); } catch (e) { setFav(isFav); toast(errMsg(e), 'error'); }
  };
  const share = async () => {
    const out = await shareLink({ title: `${c.name} on FameVote`, text: `Vote for ${c.name} on FameVote!` });
    if (out === 'copied') toast('Link copied.', 'success');
  };
  const stats = [['Votes', fmtNum(s.votes)], ['India rank', s.nationalRank ? `#${s.nationalRank}` : '–'], [`${stateName || 'State'} rank`, s.stateRank ? `#${s.stateRank}` : '–']];

  return (
    <div className="lg:container-x lg:grid lg:grid-cols-[400px_1fr] lg:gap-10 lg:py-8">
      <div className="relative -mt-px aspect-[4/5] max-h-[56dvh] w-full overflow-hidden bg-surface lg:aspect-[3/4] lg:max-h-none lg:rounded-2xl">
        <Portrait src={c.image} name={c.name} eager sizes="(min-width:1024px) 420px, 92vw" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
        <button onClick={() => nav(-1)} aria-label="Go back" className="absolute left-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white backdrop-blur lg:hidden"><ArrowLeft className="h-5 w-5" /></button>
        <div className="absolute right-4 top-4 flex gap-2">
          <button onClick={share} aria-label="Share" className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white backdrop-blur"><Share2 className="h-5 w-5" /></button>
          <button onClick={toggle} aria-pressed={Boolean(isFav)} aria-label={isFav ? 'Remove from favourites' : 'Add to favourites'} className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white backdrop-blur">
            <motion.span key={String(isFav)} initial={{ scale: isFav ? 0.4 : 1 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 12 }}><Heart className={`h-5 w-5 ${isFav ? 'fill-white text-white' : ''}`} /></motion.span>
          </button>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-5 text-white">
          <div className="flex flex-wrap items-center gap-2"><Link to={`/vote?category=${c.category?.slug}`} className="badge bg-white/15 text-white backdrop-blur">{c.category?.name}</Link>{c.gender && <span className="badge bg-white/15 text-white backdrop-blur">{GENDER_LABEL[c.gender]}{s.genderRank ? ` #${s.genderRank}` : ''}</span>}<CampaignBadge campaign={campaign} /></div>
          <h1 className="mt-2 font-heading text-[34px] font-extrabold leading-none">{c.name}</h1>
          {(stateName || c.region) && <p className="mt-2 flex items-center gap-1 text-sm text-white/75"><MapPin className="h-4 w-4" aria-hidden="true" />{[c.region, stateName].filter(Boolean).join(', ')}</p>}
        </div>
      </div>

      <div className="container-x space-y-6 pb-24 pt-5 lg:p-0 lg:pb-0">
        <dl className="grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-surface py-4">
          {stats.map(([l, v]) => <div key={l} className="px-2 text-center"><dd className="font-heading text-2xl font-extrabold tabular-nums">{l === 'Votes' ? <CountUp value={s.votes} /> : v}</dd><dt className="mt-0.5 text-xs text-ink/60">{l}</dt></div>)}
        </dl>
        {(() => {
          const rows = board.data?.entries || []; const at = rows.findIndex((e) => e.celebrityId === c.id);
          if (at < 0) return null;
          const near = rows.slice(Math.max(0, at - 2), at + 3); const top = rows[0]?.votes || 1;
          return (
            <section aria-label="Close race">
              <h2 className="mb-2 font-heading text-lg font-extrabold">The race in {c.category?.name}</h2>
              <ol className="divide-y divide-line rounded-xl border border-line bg-surface">
                {near.map((e) => (
                  <li key={e.celebrityId}>
                    <Link to={`/celebrity/${e.slug || e.celebrityId}`} aria-current={e.celebrityId === c.id ? 'true' : undefined} className={`flex min-h-[60px] items-center gap-3 px-3 py-2 ${e.celebrityId === c.id ? 'bg-brand-soft' : 'active:bg-ink/[.03]'}`}>
                      <span className="w-6 text-center font-heading text-[15px] font-extrabold tabular-nums">{e.rank}</span>
                      <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-sand"><Portrait src={e.image} name={e.name} sizes="48px" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{e.name}</span><span className="mt-1 block h-1 overflow-hidden rounded-full bg-ink/10" aria-hidden="true"><span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(3, (e.votes / top) * 100)}%` }} /></span></span>
                      <span className="text-[13px] tabular-nums text-ink/70">{fmtNum(e.votes)}</span>
                    </Link>
                  </li>))}
              </ol>
            </section>
          );
        })()}
        {s.provisional && <p className="-mt-2 text-sm text-ink">Provisional. Standings update live until voting closes.</p>}
        {c.bio && <section><h2 className="mb-1.5 font-heading text-lg font-extrabold">About</h2><p className="max-w-prose text-[16px] leading-relaxed text-ink/80">{c.bio}</p></section>}
        <section>
          <h2 className="mb-1 font-heading text-lg font-extrabold">Ranking history</h2>
          {history.length ? <ul className="divide-y divide-line">{history.map((h) => <li key={h.campaign} className="flex min-h-[52px] items-center justify-between text-[15px]"><span>{h.title?.replace(' Campaign', '')}</span><span className="font-semibold tabular-nums">#{h.rank} <span className="font-normal text-ink/55">· {fmtNum(h.votes)} votes</span></span></li>)}</ul>
            : <p className="text-[15px] text-ink/60">No finalized campaigns yet.</p>}
        </section>
        <p className="text-xs text-ink/45">Celebrity ID {c.code}{c.imageCredit && <> · Photo: <a className="underline" href={c.imageCredit} target="_blank" rel="noopener noreferrer">Wikipedia</a></>}</p>
        <div className="hidden lg:block"><button className="btn-pop !px-10" onClick={() => setPick(c)}>Vote for {c.name.split(' ')[0]}</button></div>
      </div>

      {/* Sticky vote bar on phones */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 bg-gradient-to-t from-paper via-paper/90 to-transparent px-4 pb-3 pt-8 lg:hidden">
        <button className="btn-pop pointer-events-auto w-full !min-h-[56px] !rounded-2xl text-base" onClick={() => setPick(c)}>Vote for {c.name.split(' ')[0]}</button>
      </div>
      <VoteDialog celeb={pick} category={c.category} onClose={() => setPick(null)} onVoted={r.reload} />
    </div>
  );
}
