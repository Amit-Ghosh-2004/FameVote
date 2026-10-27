import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, Sparkles, Trophy } from 'lucide-react';
import { api, unwrap, fmtNum } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { CategoryIcon, Skeleton } from './ui';

/**
 * One light row per category: who leads right now, as text. No photos on purpose: the home page below the hero
 * loads instantly on mobile data, and every row is a one-tap way into voting.
 */
export function CategoryList({ previews, loading, voted }) {
  if (loading) return <div className="space-y-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[64px]" />)}</div>;
  const rows = previews.filter((p) => p.category);
  if (!rows.length) return null;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {rows.map((p) => {
        const lead = p.entries?.[0]; const done = voted?.has(p.category.slug);
        return (
          <li key={p.category.slug}>
            <Link to={`/vote?category=${p.category.slug}`} className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-2.5 transition active:scale-[.985]">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><CategoryIcon name={p.category.icon} className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-bold leading-tight">{p.category.name}</span>
                <span className="mt-0.5 block truncate text-[13px] text-ink/60">{lead && lead.votes > 0 ? `Leading: ${lead.name} · ${fmtNum(lead.votes)} votes` : 'Be the first to vote'}</span>
              </span>
              {done ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-mint-soft px-2.5 py-1 text-[12px] font-semibold text-mint"><Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />Voted</span>
                : <ChevronRight className="h-5 w-5 shrink-0 text-ink/40" aria-hidden="true" />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** A single text link to the latest published winners (one tiny request, no images). Renders nothing until one exists. */
export function ResultsLink() {
  const list = useAsync(() => unwrap(api.get('/winners')), [], { key: 'winners', ttl: 60000 });
  const c = list.data?.campaigns?.[0];
  if (!c) return null;
  return (
    <div className="container-x mt-6"><Link to={`/winners?campaign=${c.key}`} className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 active:scale-[.99]">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><Trophy className="h-5 w-5" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="block font-bold leading-tight">{c.title.replace(' Campaign', '')} winners</span><span className="block text-[13px] text-ink/60">Final results for every category</span></span>
      <ArrowRight className="h-5 w-5 shrink-0 text-ink/40" aria-hidden="true" />
    </Link></div>
  );
}

export function NominateBand() {
  return (
    <section className="container-x mt-6 pb-2" aria-label="Nominate a celebrity">
      <Link to="/nominate" className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-dashed border-ink/25 px-4 py-3 active:scale-[.99]">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-on"><Sparkles className="h-5 w-5" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1"><span className="block font-bold leading-tight">Missing someone?</span><span className="block text-[13px] text-ink/60">Nominate a celebrity in under a minute</span></span>
        <ArrowRight className="h-5 w-5 shrink-0 text-ink/40" aria-hidden="true" />
      </Link>
    </section>
  );
}
