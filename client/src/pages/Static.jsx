import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlarmClock, BadgeCheck, CheckCircle2, CreditCard, Eye, FileCheck2, Lock, Scale, XCircle, ListChecks, Vote as VoteIcon, Receipt, CalendarDays, BarChart3, Trophy, UserPlus } from 'lucide-react';
import { api, unwrap, errMsg, inr, fmtIST } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useAsync } from '../lib/hooks';
import { PageTitle, Field } from '../components/ui';

const Section = ({ title, icon: Icon, step, children }) => (
  <section className="flex gap-4 rounded-2xl bg-surface p-5 border border-line">
    <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand"><Icon className="h-5 w-5" aria-hidden="true" />{step && <span className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-md bg-ink text-[11px] font-extrabold text-paper">{step}</span>}</span>
    <div className="min-w-0"><h2 className="font-heading text-lg font-extrabold leading-tight">{title}</h2><div className="mt-1.5 space-y-2 text-[15px] leading-relaxed text-ink/75">{children}</div></div>
  </section>
);

export function HowItWorks() {
  const { meta } = useAuth();
  const cats = useAsync(() => unwrap(api.get('/categories')), [], { key: 'categories', ttl: 300000 });
  return (
    <div className="container-x max-w-3xl pt-6">
      <PageTitle title="How it works" sub="Everything you need to know about voting on FameVote." />
      <div className="space-y-3">
        <Section title="Create an account" icon={UserPlus} step={1}><p>Create an account, choose your state or union territory, and start voting when a campaign is open. No verification email is required.</p></Section>
        <Section title="Pick a category" icon={ListChecks} step={2}><p>{cats.data?.categories?.length ? `There are ${cats.data.categories.length} categories: ${cats.data.categories.map((c) => c.name).join(', ')}.` : 'Every category has its own rankings and winners.'} Each has its own rankings and winners.</p></Section>
        <Section title="Vote once per category" icon={VoteIcon} step={3}><p>You may vote in every category, but only <strong>one celebrity per category each month</strong>. A confirmed vote cannot be changed.</p></Section>
        <Section title="Transaction amount and receipts" icon={Receipt} step={4}><p>Each vote has a transaction amount set by the platform between ₹{meta?.amountRangeInr?.[0] ?? 0} and ₹{meta?.amountRangeInr?.[1] ?? 7}. Right now it is <strong>{meta ? inr(meta.voteAmountInr) : '…'}</strong>. You always see it before you confirm. Every completed vote, free or paid, gets a receipt you can view, print, download as a PDF and verify.</p></Section>
        <Section title="Campaign dates" icon={CalendarDays} step={5}><p>Voting opens at 12:00 AM IST on the 1st and closes at 11:59:59 PM IST on the second-last day of every month. The last day is results day, and a new campaign opens on the 1st. The server clock decides, not your device.</p></Section>
        <Section title="Rankings" icon={BarChart3} step={6}><p>Each category shows the <strong>India Top 15</strong> and a <strong>State Top 10</strong> for every state and union territory. State rankings use the voter's state at the time of voting. Ties share a rank and are listed alphabetically.</p></Section>
        <Section title="Results" icon={Trophy} step={7}><p>Rankings are <em>provisional</em> while voting is open. After the campaign closes and votes are validated, results are finalized and saved permanently.</p></Section>
        <div className="flex gap-3"><Link to="/vote" className="btn-pop">Start voting</Link><Link to="/voting-integrity" className="btn-ghost">Voting integrity</Link></div>
      </div>
    </div>
  );
}

export function Integrity() {
  return (
    <div className="container-x max-w-3xl pt-6">
      <PageTitle title="Voting integrity" sub="How FameVote keeps every result fair and checkable." />
      <div className="space-y-3">
        <Section title="No duplicate votes" icon={Lock}><p>The database itself allows only one confirmed vote per user, per category, per campaign. Refreshing, opening several tabs, switching devices or replaying requests cannot create a second vote.</p></Section>
        <Section title="What counts as a valid vote" icon={BadgeCheck}><p>Only confirmed votes from signed-in accounts inside the campaign window are counted. Failed, cancelled, pending and duplicate attempts are never counted.</p></Section>
        <Section title="Payment verification" icon={CreditCard}><p>A payment screen showing "success" is not enough. The server verifies the payment signature and confirms the payment directly with the payment gateway before recording a vote. Amounts are set by the server, never the browser.</p></Section>
        <Section title="Late payments" icon={AlarmClock}><p>If a payment completes after voting closes, no vote is recorded and the payment is refunded automatically.</p></Section>
        <Section title="Fraud review" icon={Eye}><p>Suspicious activity is reviewed by authorised administrators. A vote can be disqualified only with a written reason, and every such action is recorded in a permanent audit log. Votes are never deleted or edited.</p></Section>
        <Section title="Closure and corrections" icon={Scale}><p>When a campaign closes, results are finalized once and stored as immutable snapshots. If a correction is ever needed, a new revision is published with a documented reason; the original snapshot is kept.</p></Section>
        <Section title="Verify your receipt" icon={FileCheck2}><p>Every receipt has a number and a verification reference. <Link to="/verify-receipt" className="font-semibold text-brand underline">Verify a receipt</Link> to confirm it is genuine.</p></Section>
      </div>
    </div>
  );
}

export function VerifyReceipt() {
  const [sp] = useSearchParams();
  const [no, setNo] = useState(sp.get('receiptNo') || ''); const [ref, setRef] = useState(sp.get('ref') || '');
  const [res, setRes] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(''); setRes(null);
    try { setRes(await unwrap(api.get('/receipts/verify', { params: { receiptNo: no.trim(), ref: ref.trim() } }))); } catch (x) { setErr(errMsg(x, 'Could not verify this receipt.')); } finally { setBusy(false); }
  };
  return (
    <div className="container-x max-w-lg pt-6">
      <PageTitle title="Verify a receipt" sub="Enter the receipt number and verification reference printed on the receipt." />
      <form onSubmit={submit} className="space-y-4 rounded-2xl bg-surface p-5 border border-line">
        <Field label="Receipt number" id="rn"><input id="rn" className="input" value={no} onChange={(e) => setNo(e.target.value)} placeholder="FV-202610-XXXXXXXX" required /></Field>
        <Field label="Verification reference" id="rr"><input id="rr" className="input" value={ref} onChange={(e) => setRef(e.target.value)} required /></Field>
        <button className="btn-primary w-full !min-h-[54px] text-base" disabled={busy}>{busy ? 'Checking…' : 'Verify receipt'}</button>
      </form>
      {res && <div className="mt-4 space-y-1 rounded-2xl bg-mint-soft p-5 text-[15px] text-mint" role="status"><p className="flex items-center gap-2 font-heading text-lg font-extrabold text-mint"><CheckCircle2 className="h-6 w-6" />Genuine receipt</p>
        <p>Vote for <strong>{res.celebrityName}</strong> in {res.categoryName} ({res.campaign})</p><p>Amount {inr(res.amountInr)} · Issued {fmtIST(res.issuedAt)}</p>{res.sample && <p className="pt-1 text-[13px] opacity-80">This is a sample record created for the FameVote preview.</p>}</div>}
      {err && <div className="mt-4 flex items-center gap-2 rounded-2xl bg-brand-soft p-5 text-[15px] text-brand-dark" role="alert"><XCircle className="h-5 w-5" />{err}</div>}
    </div>
  );
}
