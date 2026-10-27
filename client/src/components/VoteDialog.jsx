import Confetti from './Confetti';
import { fanLine, firstName, initialsOf, slugFromName } from '../lib/fanCopy';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, Check, Clock, Loader2, Minus, Plus, Share2, ShieldCheck } from 'lucide-react';
import { Modal, Portrait } from './ui';
import { useAuth } from '../lib/AuthContext';
import { useAsync, bustCache } from '../lib/hooks';
import { useToast } from '../lib/Toast';
import { api, unwrap, inr, fmtIST } from '../lib/api';
import { haptic, shareLink } from '../lib/fx';
import { useVoteFlow } from '../lib/useVoteFlow';

const REASONS = {
  ALREADY_VOTED: 'You have already voted in this category this month. A confirmed vote cannot be changed.',
  STATE_REQUIRED: 'Choose your state or union territory before voting. It is used for state rankings.',
  CAMPAIGN_NOT_STARTED: 'Voting has not opened yet.',
  CAMPAIGN_CLOSED: 'Voting for this campaign has closed.',
};

const Row = ({ k, children }) => <div className="flex items-center justify-between gap-4 py-3 text-[15px]"><dt className="text-ink/60">{k}</dt><dd className="text-right font-semibold">{children}</dd></div>;

/** "- 7 +": the voter picks a whole-rupee amount. The server re-validates it; it never changes how a vote counts. */
function AmountStepper({ value, onChange, min = 0, max = 7 }) {
  const set = (n) => { const v = Math.min(max, Math.max(min, n)); if (v !== value) { haptic(8); onChange(v); } };
  return (
    <div>
      <div role="group" aria-label="Amount in rupees" className="flex items-stretch justify-between gap-3">
        <button type="button" onClick={() => set(value - 1)} disabled={value <= min} aria-label="Decrease amount" className="grid h-16 w-16 shrink-0 place-items-center rounded-xl border border-ink/20 bg-surface text-ink transition active:scale-95 disabled:opacity-35"><Minus className="h-6 w-6" strokeWidth={2} /></button>
        <output aria-live="polite" className="flex flex-1 flex-col items-center justify-center rounded-xl border border-line bg-surface">
          <span className="font-heading text-[44px] font-extrabold leading-none tnum">{value === 0 ? 'Free' : `₹${value}`}</span>
          <span className="mt-1 text-xs text-ink/55">{value === 0 ? 'no payment' : value === 1 ? '1 rupee' : `${value} rupees`}</span>
        </output>
        <button type="button" onClick={() => set(value + 1)} disabled={value >= max} aria-label="Increase amount" className="grid h-16 w-16 shrink-0 place-items-center rounded-xl border border-ink/20 bg-surface text-ink transition active:scale-95 disabled:opacity-35"><Plus className="h-6 w-6" strokeWidth={2} /></button>
      </div>
      <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Quick amounts">
        {[0, 1, 3, 5, 7].map((n) => <button key={n} type="button" role="radio" aria-checked={value === n} onClick={() => set(n)} className="chip flex-1 justify-center !px-0">{n === 0 ? 'Free' : `₹${n}`}</button>)}
      </div>
    </div>
  );
}

/** The confirmation ticket shown after a vote is recorded. */
function Ticket({ receipt, onDone, next, onNext }) {
  const toast = useToast();
  useEffect(() => { haptic([18, 40, 18]); }, []);
  const share = async () => {
    const r = await shareLink({ title: 'I voted on FameVote', text: `Team ${firstName(receipt.celebrityName)}! I just voted for ${receipt.celebrityName} in ${receipt.categoryName} on FameVote. Your turn?`, url: window.location.origin });
    if (r === 'copied') toast('Link copied. Paste it anywhere.', 'success');
  };
  return (
    <div className="pb-2" role="status">
      <div className="relative">
        <Confetti seed={receipt.receiptNo?.length || 1} />
      <div className="relative overflow-hidden rounded-2xl border border-ink bg-surface">
        <div className="relative bg-brand px-5 pb-5 pt-5 text-on">
          <div className="flex items-center gap-3">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-amber-300 font-heading text-xl font-extrabold text-ink ring-4 ring-white/90">{initialsOf(receipt.celebrityName)}</span>
            <div className="min-w-0">
              <p className="text-[13px] italic text-on/90">{fanLine(slugFromName(receipt.categoryName), receipt.receiptNo)}</p>
              <p className="truncate font-heading text-[26px] font-extrabold leading-[1.05]">{receipt.celebrityName}</p>
            </div>
          </div>
          <p className="mt-2 text-sm text-on/90">{receipt.categoryName} · {receipt.campaignLabel}</p>
          <span className="stamp absolute right-3 top-3 -rotate-6 animate-stamp bg-surface !text-brand-dark !border-brand-dark"><Check className="h-4 w-4" strokeWidth={3.5} />COUNTED!</span>
        </div>
        <div className="perf"><i className="!bg-paper" /><i className="!bg-paper" /></div>
        <dl className="space-y-1 px-5 pb-4 pt-1 text-sm">
          <div className="flex justify-between"><dt className="text-ink/60">Receipt</dt><dd className="font-semibold tnum">{receipt.receiptNo}</dd></div>
          <div className="flex justify-between"><dt className="text-ink/60">Amount</dt><dd className="font-semibold">{inr(receipt.amountInr)}</dd></div>
        </dl>
      </div>
      </div>
      {next && <button className="btn-pop mt-4 w-full !min-h-[54px] text-base" onClick={onNext} data-autofocus>Next: vote in {next.name}</button>}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Link to={`/dashboard/receipts/${receipt.id}`} className="btn-primary">View receipt</Link>
        <button className="btn-ghost" onClick={onDone}>{next ? 'Done for now' : 'Keep voting'}</button>
      </div>
      <button className="btn-ghost mt-3 w-full" onClick={share}><Share2 className="h-4 w-4" />Rally Team {firstName(receipt.celebrityName)}</button>
    </div>
  );
}

export default function VoteDialog({ celeb, category, onClose, onVoted, nextCategory, onNext }) {
  const { user, refresh, meta } = useAuth();
  const loc = useLocation();
  const flow = useVoteFlow();
  const [amount, setAmount] = useState(null);
  const categoryId = category?.id || celeb?.categoryId;
  const elig = useAsync(() => (user && celeb ? unwrap(api.get('/votes/eligibility', { params: { categoryId } })) : Promise.resolve(null)), [user?.id, celeb?.id, categoryId]);
  const e = elig.data;
  useEffect(() => { if (e) setAmount((a) => a ?? e.amountInr); }, [e]);
  useEffect(() => { if (!celeb) setAmount(null); }, [celeb]);
  const custom = e?.allowCustomAmount !== false;
  const chosen = custom ? (amount ?? e?.amountInr ?? 0) : (e?.amountInr ?? 0);
  const noPayments = chosen > 0 && e?.paymentsAvailable === false;
  const busy = flow.step === 'processing' || flow.step === 'verifying';
  const close = () => { if (busy) return; if (flow.step === 'done') { ['mine:', 'rank', 'me/dashboard', 'celeb:', 'celebs:'].forEach(bustCache); onVoted?.(); } flow.reset(); onClose(); };
  const title = flow.step === 'done' ? 'Vote confirmed' : 'Confirm your vote';

  return (
    <Modal open={Boolean(celeb)} onClose={close} title={title}>
      {celeb && (
        <div className="space-y-4 pb-2">
          {flow.step !== 'done' && (
            <div className="flex items-center gap-4">
              <div className="h-24 w-[76px] shrink-0 overflow-hidden rounded-xl bg-sand"><Portrait src={celeb.image} name={celeb.name} sizes="80px" /></div>
              <div className="min-w-0">
                <p className="font-heading text-[22px] font-extrabold leading-tight">{celeb.name}</p>
                <p className="mt-0.5 text-sm text-ink/60">{category?.name || celeb.category?.name}</p>
                <Link to={`/celebrity/${celeb.slug || celeb.id}`} onClick={() => { flow.reset(); onClose(); }} className="mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-brand underline underline-offset-4">View profile</Link>
              </div>
            </div>
          )}

          {!user && (
            <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
              <p className="text-[15px]">Log in to cast your vote. It takes under a minute, and every account gets one vote per category each month.</p>
              <div className="grid grid-cols-2 gap-3">
                <Link to="/login" state={{ from: loc.pathname + loc.search }} className="btn-primary">Log in</Link>
                <Link to="/register" state={{ from: loc.pathname + loc.search }} className="btn-ghost">Sign up</Link>
              </div>
            </div>
          )}

          {user && elig.loading && <p className="flex items-center gap-2 py-4 text-[15px] text-ink/70"><Loader2 className="h-4 w-4 animate-spin" />Checking if you can vote…</p>}

          {user && e && flow.step === 'idle' && (e.canVote ? (
            <>
              {custom ? (
                <section aria-label="Choose your amount">
                  <p className="label !mb-2">Your amount</p>
                  <AmountStepper value={chosen} onChange={setAmount} min={e.rangeInr?.[0] ?? 0} max={e.rangeInr?.[1] ?? 7} />
                  <p className="mt-3 text-[13px] text-ink/60">Pick ₹{e.rangeInr?.[0] ?? 0} to vote for free, or up to ₹{e.rangeInr?.[1] ?? 7}. Every vote counts the same, whatever the amount.</p>
                </section>
              ) : (
                <dl className="divide-y divide-line rounded-xl border border-line bg-surface px-4"><Row k="Amount"><span className="font-heading text-lg font-extrabold">{chosen === 0 ? 'Free' : inr(chosen)}</span></Row></dl>
              )}
              <dl className="divide-y divide-line rounded-xl border border-line bg-surface px-4">
                <Row k="Campaign">{e.campaign.title.replace(' Campaign', '')}</Row>
                <Row k="Voting from">{meta?.states?.find((x) => x.code === user.state)?.name || user.state}</Row>
              </dl>
              <p className="flex items-start gap-2 text-[13px] text-ink/60"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink" strokeWidth={1.75} aria-hidden="true" />One vote per category each month. Once confirmed it cannot be changed. You get a receipt either way.</p>
              {noPayments && <p className="rounded-lg bg-sand p-3 text-[14px]" role="status">Paid votes are not switched on yet. Choose Free to vote now.</p>}
              <button data-autofocus className="btn-pop w-full !min-h-[56px] text-base" disabled={noPayments} onClick={() => flow.submit({ categoryId, celebrityId: celeb.id, amountInr: chosen })}>
                {chosen === 0 ? `Vote for ${celeb.name.split(' ')[0]}, free` : `Pay ${inr(chosen)} and vote`}
              </button>
            </>
          ) : (
            <div className="space-y-3 rounded-xl bg-sand p-4 text-[15px]">
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />
                <div className="space-y-1">
                  <p>{REASONS[e.reason] || 'You cannot vote right now.'}</p>
                  {e.votedFor && <p className="font-semibold">You voted for {e.votedFor.celebrity} on {fmtIST(e.votedFor.at)}.</p>}
                </div>
              </div>
              {e.reason === 'STATE_REQUIRED' && <Link to="/dashboard/profile" className="btn-primary w-full">Set my state</Link>}
              {e.reason === 'ALREADY_VOTED' && <button className="btn-ghost w-full" onClick={close}>Pick another category</button>}
            </div>
          ))}

          {busy && <p className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface py-6 text-[15px]" role="status"><Loader2 className="h-5 w-5 animate-spin" />{flow.step === 'verifying' ? 'Confirming your payment securely…' : 'Recording your vote…'}</p>}

          {flow.step === 'done' && flow.receipt && <Ticket receipt={flow.receipt} onDone={close} next={nextCategory} onNext={() => { close(); onNext?.(nextCategory.slug); }} />}

          {flow.step === 'pending' && <div className="rounded-xl bg-sand p-4 text-[15px]">Your payment is still being confirmed. Your vote and receipt will appear in your dashboard shortly. You do not need to pay again.</div>}
          {flow.step === 'cancelled' && <div className="space-y-3"><p className="text-[15px]">Payment cancelled. No vote was recorded.</p><button className="btn-ghost w-full" onClick={flow.reset}>Back</button></div>}
          {(flow.step === 'error' || flow.step === 'refund') && (
            <div role="alert" className="space-y-3 rounded-xl bg-brand-soft p-4 text-[15px] text-brand-dark">
              <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />{flow.error?.message}</p>
              <button className="btn-ghost w-full" onClick={flow.reset}>Back</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
