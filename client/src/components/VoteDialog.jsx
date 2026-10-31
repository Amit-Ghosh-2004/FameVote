import Confetti from './Confetti';
import { fanLine, firstName, initialsOf, slugFromName } from '../lib/fanCopy';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, Check, Clock, Loader2, Share2, ShieldCheck } from 'lucide-react';
import { Portrait } from './ui';
import { Modal } from './Overlay';
import { useAuth } from '../lib/AuthContext';
import { useAsync, bustCache } from '../lib/hooks';
import { useToast } from '../lib/Toast';
import { api, unwrap, inr, fmtIST } from '../lib/api';
import { haptic, shareLink } from '../lib/fx';
import { useVoteFlow } from '../lib/useVoteFlow';

const REASONS = {
  ALREADY_VOTED: 'You already voted in this category this month. Votes can\'t be changed.',
  STATE_REQUIRED: 'Choose your state before you vote. We use it for state rankings.',
  CAMPAIGN_NOT_STARTED: 'Voting has not opened yet.',
  CAMPAIGN_CLOSED: 'Voting is closed for this month.',
};

/** Amount picker: Free and ₹1 to ₹7 as big tap targets. The server re-validates it; it never changes how a vote counts. */
function AmountPicker({ value, onChange, min = 0, max = 7 }) {
  const opts = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div role="radiogroup" aria-label="Amount in rupees" className="grid grid-cols-4 gap-2">
      {opts.map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} onClick={() => { if (n !== value) { haptic(8); onChange(n); } }} className="chip !min-h-[52px] !px-0 !text-[16px]">{n === 0 ? 'Free' : `₹${n}`}</button>
      ))}
    </div>
  );
}

/** The confirmation: a dark ticket with a stamp, confetti and the receipt number. */
function Ticket({ receipt, onDone, next, onNext }) {
  const toast = useToast();
  useEffect(() => { haptic([18, 40, 18]); }, []);
  const share = async () => {
    const r = await shareLink({ title: 'I voted on FameVote', text: `Team ${firstName(receipt.celebrityName)}! I just voted for ${receipt.celebrityName} in ${receipt.categoryName} on FameVote. Your turn?`, url: window.location.origin });
    if (r === 'copied') toast('Link copied. Paste it anywhere.', 'success');
  };
  return (
    <div role="status">
      <div className="relative">
        <Confetti seed={receipt.receiptNo?.length || 1} />
        <div className="overflow-hidden rounded-3xl border border-line">
          <div className="stage px-5 pb-6 pt-5 text-center">
            <span className="mx-auto grid h-16 w-16 animate-pop place-items-center rounded-full bg-white text-[22px] font-bold text-[#1a1c0c]">{initialsOf(receipt.celebrityName)}</span>
            <p className="mt-3 text-[14px] font-semibold text-ink/85">{fanLine(slugFromName(receipt.categoryName), receipt.receiptNo)}</p>
            <p className="mt-0.5 text-[26px] font-bold leading-tight [overflow-wrap:anywhere]">{receipt.celebrityName}</p>
            <p className="mt-1 text-[14px] text-ink/75">{receipt.categoryName} · {receipt.campaignLabel}</p>
            <span className="stamp mt-4 animate-stamp bg-surface "><Check className="h-4 w-4" strokeWidth={3.5} />VOTE COUNTED</span>
          </div>
          <div className="perf bg-paper"><i className="!bg-surface" /><i className="!bg-surface" /></div>
          <dl className="space-y-1.5 bg-paper px-5 pb-4 pt-1 text-[14px]">
            <div className="flex justify-between gap-3"><dt className="text-ink/65">Receipt</dt><dd className="font-bold tnum">{receipt.receiptNo}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink/65">Amount</dt><dd className="font-bold">{inr(receipt.amountInr)}</dd></div>
          </dl>
        </div>
      </div>
      {next && <button className="btn-pop mt-4 w-full !min-h-[56px] text-[16px]" onClick={onNext} data-autofocus>Vote in {next.name}</button>}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Link to={`/dashboard/receipts/${receipt.id}`} className="btn-primary">View receipt</Link>
        <button className="btn-ghost" onClick={share}><Share2 className="h-4 w-4" />Share</button>
      </div>
      <button className="mt-1 min-h-[48px] w-full text-[14px] font-bold text-ink/65" onClick={onDone}>{next ? 'Not now' : 'Keep voting'}</button>
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
  const title = flow.step === 'done' ? 'Vote counted' : 'Your vote';

  return (
    <Modal open={Boolean(celeb)} onClose={close} title={title}>
      {celeb && (
        <div className="space-y-4 pb-2">
          {flow.step !== 'done' && (
            <div className="flex items-center gap-4">
              <div className="h-[92px] w-[72px] shrink-0 overflow-hidden rounded-2xl bg-ink/[.06]"><Portrait src={celeb.image} name={celeb.name} sizes="80px" /></div>
              <div className="min-w-0">
                <p className="text-[22px] font-bold leading-tight [overflow-wrap:anywhere]">{celeb.name}</p>
                <p className="mt-0.5 text-[14px] text-ink/65">{category?.name || celeb.category?.name}</p>
                <Link to={`/celebrity/${celeb.slug || celeb.id}`} onClick={() => { flow.reset(); onClose(); }} className="mt-0.5 inline-flex min-h-[44px] items-center text-[14px] font-bold text-brand">See profile</Link>
              </div>
            </div>
          )}

          {!user && (
            <div className="space-y-3 rounded-2xl bg-ink/[.06] p-4">
              <p className="text-[15px] font-semibold">Log in to vote. It takes under a minute.</p>
              <div className="grid grid-cols-2 gap-3">
                <Link to="/login" state={{ from: loc.pathname + loc.search }} className="btn-primary">Log in</Link>
                <Link to="/register" state={{ from: loc.pathname + loc.search }} className="btn-ghost">Sign up</Link>
              </div>
            </div>
          )}

          {user && elig.loading && <p className="flex items-center gap-2 py-4 text-[15px] text-ink/70"><Loader2 className="h-4 w-4 animate-spin" />Checking…</p>}

          {user && e && flow.step === 'idle' && (e.canVote ? (
            <>
              {custom ? (
                <section aria-label="Choose your amount">
                  <p className="label">Pay what you like</p>
                  <AmountPicker value={chosen} onChange={setAmount} min={e.rangeInr?.[0] ?? 0} max={e.rangeInr?.[1] ?? 7} />
                  <p className="mt-2.5 text-[13.5px] text-ink/65">Every vote counts the same, free or paid.</p>
                </section>
              ) : (
                <p className="flex items-center justify-between rounded-2xl bg-ink/[.06] px-4 py-3 text-[15px]"><span className="text-ink/70">Amount</span><span className="text-lg font-bold">{chosen === 0 ? 'Free' : inr(chosen)}</span></p>
              )}
              {noPayments && <p className="rounded-2xl bg-ink/[.06] p-3 text-[14px]" role="status">Paid votes are not on yet. Choose Free to vote now.</p>}
              <button data-autofocus className="btn-pop w-full !min-h-[58px] text-[16px]" disabled={noPayments} onClick={() => flow.submit({ categoryId, celebrityId: celeb.id, amountInr: chosen })}>
                {chosen === 0 ? `Vote for ${celeb.name.split(' ')[0]}` : `Pay ${inr(chosen)} and vote`}
              </button>
              <p className="flex items-start justify-center gap-1.5 text-center text-[13px] text-ink/65"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />One vote per category each month. It can't be changed.</p>
            </>
          ) : (
            <div className="space-y-3 rounded-2xl bg-ink/[.06] p-4 text-[15px]">
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />
                <div className="space-y-1">
                  <p>{REASONS[e.reason] || "You can't vote right now."}</p>
                  {e.votedFor && <p className="font-bold">You voted for {e.votedFor.celebrity} on {fmtIST(e.votedFor.at)}.</p>}
                </div>
              </div>
              {e.reason === 'STATE_REQUIRED' && <Link to="/dashboard/profile" className="btn-primary w-full">Choose my state</Link>}
              {e.reason === 'ALREADY_VOTED' && <button className="btn-ghost w-full" onClick={close}>Try another category</button>}
            </div>
          ))}

          {busy && <p className="flex items-center justify-center gap-2 rounded-2xl bg-ink/[.06] py-7 text-[15px] font-semibold" role="status"><Loader2 className="h-5 w-5 animate-spin" />{flow.step === 'verifying' ? 'Confirming your payment…' : 'Counting your vote…'}</p>}

          {flow.step === 'done' && flow.receipt && <Ticket receipt={flow.receipt} onDone={close} next={nextCategory} onNext={() => { close(); onNext?.(nextCategory.slug); }} />}

          {flow.step === 'pending' && <div className="rounded-2xl bg-ink/[.06] p-4 text-[15px]">We are still confirming your payment. Your vote and receipt will show in your account soon. You do not need to pay again.</div>}
          {flow.step === 'cancelled' && <div className="space-y-3"><p className="text-[15px]">Payment cancelled. No vote was recorded.</p><button className="btn-ghost w-full" onClick={flow.reset}>Back</button></div>}
          {(flow.step === 'error' || flow.step === 'refund') && (
            <div role="alert" className="space-y-3 rounded-xl border border-red-700/30 bg-red-700/[.07] p-4 text-[15px] text-ink">
              <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />{flow.error?.message}</p>
              <button className="btn-ghost w-full" onClick={flow.reset}>Back</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
