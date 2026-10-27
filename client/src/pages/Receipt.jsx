import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Download, Printer, Share2, ShieldCheck } from 'lucide-react';
import { api, unwrap, inr, fmtIST } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useToast } from '../lib/Toast';
import { shareLink } from '../lib/fx';
import { Skeleton, ErrorState } from '../components/ui';
import Confetti from '../components/Confetti';
import { fanLine, firstName, initialsOf, slugFromName } from '../lib/fanCopy';

const Row = ({ k, v }) => <div className="flex flex-col gap-0.5 py-3 text-[14px] min-[420px]:flex-row min-[420px]:justify-between min-[420px]:gap-4"><dt className="shrink-0 text-ink/55">{k}</dt><dd className="font-semibold [overflow-wrap:anywhere] min-[420px]:text-right">{v}</dd></div>;

export default function ReceiptPage() {
  const { id } = useParams(); const toast = useToast();
  const r = useAsync(() => unwrap(api.get(`/receipts/${id}`)), [id]);
  if (r.loading) return <div className="container-x max-w-md py-6"><Skeleton className="h-[520px]" /></div>;
  if (r.error) return <div className="container-x max-w-md py-8"><ErrorState message="This receipt was not found." onRetry={r.reload} /></div>;
  const x = r.data.receipt;
  const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  const verifyPath = `/verify-receipt?receiptNo=${x.receiptNo}&ref=${x.verificationRef}`;
  const share = async () => { const o = await shareLink({ title: 'FameVote receipt', text: `Team ${firstName(x.celebrityName)}! I voted for ${x.celebrityName} on FameVote. Receipt ${x.receiptNo}`, url: `${window.location.origin}${verifyPath}` }); if (o === 'copied') toast('Verification link copied.', 'success'); };

  return (
    <div className="container-x max-w-md py-5">
      <Link to="/dashboard/receipts" className="no-print mb-4 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-brand"><ArrowLeft className="h-4 w-4" />All receipts</Link>
      <article className="print-area" aria-label="Voting receipt">
        <div className="relative">
          <Confetti count={34} seed={x.receiptNo.length} />
          <div className="relative overflow-hidden rounded-3xl bg-brand px-6 pb-8 pt-6 text-center text-on">
            <p className="text-left text-sm font-bold tracking-wide text-on/95">FameVote <span className="font-medium opacity-80">· fan vote receipt</span></p>
            <span className="mx-auto mt-4 grid h-24 w-24 place-items-center rounded-full bg-amber-300 font-heading text-[34px] font-extrabold text-ink ring-[6px] ring-white">{initialsOf(x.celebrityName)}</span>
            <p className="mt-4 text-[15px] italic text-on/95">{fanLine(slugFromName(x.categoryName), x.receiptNo)}</p>
            <h1 className="font-heading text-[34px] font-extrabold leading-[1.05]">{x.celebrityName}</h1>
            <p className="mt-1.5 text-[15px] text-on/90">{x.categoryName} · {x.campaignLabel}</p>
            <span className="stamp mt-5 animate-stamp bg-surface !border-brand-dark !text-brand-dark"><Check className="h-4 w-4" strokeWidth={3.5} />VOTE COUNTED!</span>
          </div>
        </div>
        <div className="perf -my-px"><i /><i /></div>
        <div className="rounded-2xl border border-line bg-surface px-6 pb-5 pt-3">
          <p className="pb-1 pt-1 text-center font-heading text-lg font-extrabold tracking-wide tabular-nums text-brand-dark">{x.receiptNo}</p>
          <dl className="divide-y divide-line">
            <Row k="Date & time (IST)" v={fmtIST(x.issuedAt)} />
            <Row k="Fan" v={`${x.userName} (${x.userMasked})`} />
            <Row k="Celebrity ID" v={x.celebrityCode} />
            <Row k="Fan state" v={x.stateName || '–'} />
            <Row k="Amount paid" v={inr(x.amountInr)} />
            <Row k="Status" v="Completed · vote confirmed" />
            {x.razorpayPaymentId && <Row k="Razorpay payment ID" v={x.razorpayPaymentId} />}
            <Row k="Verification ref." v={x.verificationRef} />
          </dl>
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-mint-soft p-3.5 text-[13px] leading-snug text-mint"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{x.statement} Anyone can check it on <Link className="font-semibold underline" to={verifyPath}>the verification page</Link>.</span></p>
        </div>
      </article>
      <div className="no-print mt-4 grid grid-cols-2 gap-3">
        <a className="btn-primary" href={`${base}/api/receipts/${x.id}/pdf`}><Download className="h-4 w-4" />PDF</a>
        <button className="btn-ghost" onClick={share}><Share2 className="h-4 w-4" />Share</button>
        <Link to="/vote" className="btn-pop col-span-2">Vote in another category</Link>
        <button className="btn-ghost col-span-2" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</button>
      </div>
    </div>
  );
}
