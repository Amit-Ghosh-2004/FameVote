import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Download, Printer, Share2, ShieldCheck } from 'lucide-react';
import { api, unwrap, inr, fmtIST } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useToast } from '../lib/Toast';
import { shareLink } from '../lib/fx';
import { Skeleton, ErrorState } from '../components/ui';
import Confetti from '../components/Confetti';
import { fanLine, firstName, initialsOf, slugFromName } from '../lib/fanCopy';

const Row = ({ k, v, wide }) => <div className={wide ? 'col-span-2' : ''}><dt className="text-[12px] font-semibold text-ink/60">{k}</dt><dd className="mt-0.5 text-[14.5px] font-bold [overflow-wrap:anywhere]">{v}</dd></div>;

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
    <div className="container-x max-w-md py-4 lg:py-8">
      <Link to="/dashboard/receipts" className="no-print mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-bold text-brand"><ArrowLeft className="h-4 w-4" />All receipts</Link>
      <article className="print-area" aria-label="Voting receipt">
        <div className="relative">
          <Confetti count={28} seed={x.receiptNo.length} />
          <div className="stage rounded-t-[28px] px-6 pb-7 pt-5 text-center">
            <p className="text-left text-sm font-bold text-ink/90">FameVote <span className="font-semibold opacity-70">· vote receipt</span></p>
            <span className="mx-auto mt-4 grid h-[76px] w-[76px] animate-pop place-items-center rounded-full bg-white text-[28px] font-bold text-[#1a1c0c]">{initialsOf(x.celebrityName)}</span>
            <p className="mt-3 text-[14.5px] font-semibold text-ink/85">{fanLine(slugFromName(x.categoryName), x.receiptNo)}</p>
            <h1 className="text-[clamp(26px,7.4vw,32px)] font-bold leading-tight [overflow-wrap:anywhere]">{x.celebrityName}</h1>
            <p className="mt-1 text-[14.5px] text-ink/75">{x.categoryName} · {x.campaignLabel}</p>
            <span className="stamp mt-4 animate-stamp bg-surface "><Check className="h-4 w-4" strokeWidth={3.5} />VOTE COUNTED</span>
          </div>
        </div>
        <div className="perf -my-px"><i /><i /></div>
        <div className="rounded-b-[28px] border border-t-0 border-line bg-surface px-6 pb-5 pt-1">
          <p className="pb-3 text-center text-[18px] font-bold tabular-nums">{x.receiptNo}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 border-t border-line pt-4">
            <Row k="Date and time (IST)" v={fmtIST(x.issuedAt)} wide />
            <Row k="Amount" v={inr(x.amountInr)} />
            <Row k="Status" v="Vote counted" />
            <Row k="Fan" v={`${x.userName} (${x.userMasked})`} wide />
            <Row k="Celebrity ID" v={x.celebrityCode} />
            <Row k="Fan state" v={x.stateName || '–'} />
            {x.razorpayPaymentId && <Row k="Payment ID" v={x.razorpayPaymentId} wide />}
            <Row k="Check code" v={x.verificationRef} wide />
          </dl>
          <p className="mt-4 flex items-start gap-2 rounded-2xl bg-brand/10 p-3.5 text-[13px] leading-snug text-ink/80"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{x.statement} Anyone can check it on <Link className="font-bold underline" to={verifyPath}>the check page</Link>.</span></p>
        </div>
      </article>
      <div className="no-print mt-4 grid grid-cols-2 gap-3">
        <Link to="/vote" className="btn-pop col-span-2 !min-h-[54px] text-[16px]">Vote in another category</Link>
        <a className="btn-primary" href={`${base}/api/receipts/${x.id}/pdf`}><Download className="h-4 w-4" />Download PDF</a>
        <button className="btn-ghost" onClick={share}><Share2 className="h-4 w-4" />Share</button>
        <button className="col-span-2 min-h-[44px] text-[14px] font-bold text-ink/65" onClick={() => window.print()}><Printer className="mr-1.5 inline h-4 w-4" />Print</button>
      </div>
    </div>
  );
}
