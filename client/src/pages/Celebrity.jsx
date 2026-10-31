import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Heart, MapPin, Share2 } from 'lucide-react';
import { haptic, shareLink } from '../lib/fx';
import { api, unwrap, fmtNum, errMsg } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useDocTitle } from '../lib/title';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/Toast';
import { Portrait, Skeleton, ErrorState, CampaignBadge, GENDER_LABEL } from '../components/ui';
import { CountUp } from '../components/Overlay';
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

  const icoBtn = 'grid h-11 w-11 place-items-center rounded-full border border-line bg-ink/[.06] text-ink transition active:scale-95 hover:bg-ink/[.05]';
  return (
    <div className="container-x pb-6 pt-3 lg:grid lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-14 lg:py-10 xl:gap-20">
      <div className="lg:sticky lg:top-24 lg:self-start">
        <div className="mb-3 flex items-center justify-between lg:hidden">
          <button onClick={() => nav(-1)} aria-label="Go back" className={icoBtn}><ArrowLeft className="h-5 w-5" /></button>
          <div className="flex gap-2">
            <button onClick={share} aria-label="Share" className={icoBtn}><Share2 className="h-5 w-5" /></button>
            <button onClick={toggle} aria-pressed={Boolean(isFav)} aria-label={isFav ? 'Remove from favourites' : 'Add to favourites'} className={icoBtn}><Heart className={`h-5 w-5 ${isFav ? 'fill-current' : ''}`} /></button>
          </div>
        </div>
        <div className="relative mx-auto aspect-[4/5] max-h-[52dvh] w-full max-w-[420px] overflow-hidden rounded-[28px] bg-sand lg:max-h-none lg:max-w-none">
          <Portrait src={c.image} name={c.name} eager sizes="(min-width:1024px) 380px, 92vw" />
        </div>
      </div>

      <div className="space-y-6 pb-44 pt-5 lg:p-0">
        <header>
          <div className="flex flex-wrap items-center gap-2"><Link to={`/vote?category=${c.category?.slug}`} className="badge">{c.category?.name}</Link>{c.gender && <span className="badge">{GENDER_LABEL[c.gender]}{s.genderRank ? ` #${s.genderRank}` : ''}</span>}{campaign && <CampaignBadge campaign={campaign} />}</div>
          <div className="mt-2 flex items-start justify-between gap-4">
            <h1 className="text-[32px] font-bold leading-[1.05] lg:text-5xl">{c.name}</h1>
            <div className="hidden shrink-0 gap-2 lg:flex">
              <button onClick={share} aria-label="Share" className={icoBtn}><Share2 className="h-5 w-5" /></button>
              <button onClick={toggle} aria-pressed={Boolean(isFav)} aria-label={isFav ? 'Remove from favourites' : 'Add to favourites'} className={icoBtn}><Heart className={`h-5 w-5 ${isFav ? 'fill-current' : ''}`} /></button>
            </div>
          </div>
          {(stateName || c.region) && <p className="mt-2 flex items-center gap-1 text-[14px] text-ink/70"><MapPin className="h-4 w-4" aria-hidden="true" />{[c.region, stateName].filter(Boolean).join(', ')}</p>}
        </header>
        <dl className="card grid grid-cols-3 divide-x divide-line py-4">
          {stats.map(([l, v]) => <div key={l} className="px-2 text-center"><dd className="text-2xl font-bold tabular-nums">{l === 'Votes' ? <CountUp value={s.votes} /> : v}</dd><dt className="mt-0.5 text-xs text-ink/60">{l}</dt></div>)}
        </dl>
        {(() => {
          const rows = board.data?.entries || []; const at = rows.findIndex((e) => e.celebrityId === c.id);
          if (at < 0) return null;
          const near = rows.slice(Math.max(0, at - 2), at + 3); const top = rows[0]?.votes || 1;
          return (
            <section aria-label="Close race">
              <h2 className="mb-2 text-[17px] font-semibold">The race in {c.category?.name}</h2>
              <ol className="card rule-list overflow-hidden">
                {near.map((e) => (
                  <li key={e.celebrityId}>
                    <Link to={`/celebrity/${e.slug || e.celebrityId}`} aria-current={e.celebrityId === c.id ? 'true' : undefined} className={`flex min-h-[60px] items-center gap-3 px-3 py-2 ${e.celebrityId === c.id ? 'bg-brand/10' : 'active:bg-ink/[.03]'}`}>
                      <span className="w-6 text-center text-[15px] font-bold tabular-nums">{e.rank}</span>
                      <span className="h-[50px] w-10 shrink-0 overflow-hidden rounded-xl bg-sand"><Portrait src={e.image} name={e.name} sizes="48px" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{e.name}</span><span className="mt-1 block h-1 overflow-hidden rounded-full bg-ink/10" aria-hidden="true"><span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(3, (e.votes / top) * 100)}%` }} /></span></span>
                      <span className="text-[13px] tabular-nums text-ink/70">{fmtNum(e.votes)}</span>
                    </Link>
                  </li>))}
              </ol>
            </section>
          );
        })()}
        {s.provisional && <p className="-mt-2 text-sm text-ink">Provisional. Standings update live until voting closes.</p>}
        {c.bio && <section><h2 className="mb-1.5 text-[17px] font-semibold">About</h2><p className="max-w-prose text-[16px] leading-relaxed text-ink/80">{c.bio}</p></section>}
        <section>
          <h2 className="mb-1 text-[17px] font-semibold">Ranking history</h2>
          {history.length ? <ul className="divide-y divide-line">{history.map((h) => <li key={h.campaign} className="flex min-h-[52px] items-center justify-between text-[15px]"><span>{h.title?.replace(' Campaign', '')}</span><span className="font-semibold tabular-nums">#{h.rank} <span className="font-normal text-ink/55">· {fmtNum(h.votes)} votes</span></span></li>)}</ul>
            : <p className="text-[15px] text-ink/60">No finalized campaigns yet.</p>}
        </section>
        <p className="text-xs text-ink/45">Celebrity ID {c.code}{c.imageCredit && <> · Photo: <a className="underline" href={c.imageCredit} target="_blank" rel="noopener noreferrer">Wikipedia</a></>}</p>
        <div className="hidden lg:block"><button className="btn-pop !px-10" onClick={() => setPick(c)}>Vote for {c.name.split(' ')[0]}</button></div>
      </div>

      {/* Sticky vote bar on phones: fades into the page and sits above the floating dock */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-paper via-paper/95 to-transparent px-4 pb-[calc(96px+env(safe-area-inset-bottom))] pt-10 lg:hidden">
        <button className="btn-pop pointer-events-auto w-full !min-h-[52px]" onClick={() => setPick(c)}>Vote for {c.name.split(' ')[0]}</button>
      </div>
      <VoteDialog celeb={pick} category={c.category} onClose={() => setPick(null)} onVoted={r.reload} />
    </div>
  );
}
