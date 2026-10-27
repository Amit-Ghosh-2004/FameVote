const PDFDocument = require('pdfkit');
const { Receipt, User, Celebrity, Category, Campaign } = require('../models');
const { randomToken, receiptVerificationRef, maskEmail, safeEqual } = require('../utils/crypto');
const { contactOf } = require('../utils/phone');
const { formatIST, monthLabel } = require('../utils/time');
const { stateName } = require('../utils/states');
const ApiError = require('../utils/ApiError');

/**
 * Issues the (single) receipt for a confirmed vote. Idempotent: voteId/paymentId are unique,
 * so a second call returns the existing receipt instead of creating a duplicate.
 */
async function issueReceipt(vote, payment, session = null) {
  const opts = session ? { session } : {};
  const existing = await Receipt.findOne({ voteId: vote._id }).session(session);
  if (existing) return existing;

  const [user, celebrity, category, campaign] = await Promise.all([
    User.findById(vote.userId).session(session),
    Celebrity.findById(vote.celebrityId).session(session),
    Category.findById(vote.categoryId).session(session),
    Campaign.findById(vote.campaignId).session(session),
  ]);

  const base = {
    userId: vote.userId, voteId: vote._id, paymentId: payment._id, campaignId: vote.campaignId,
    snapshot: {
      userName: user.name, userMasked: contactOf(user.email, maskEmail),
      celebrityId: celebrity._id, celebrityCode: celebrity.code, celebrityName: celebrity.name,
      categoryId: category._id, categoryName: category.name,
      campaignLabel: monthLabel(campaign.year, campaign.month),
      state: vote.state, stateName: stateName(vote.state),
      amountPaise: payment.amountPaise, currency: 'INR',
      transactionStatus: 'completed',
      razorpayPaymentId: payment.razorpayPaymentId || null,
      paymentMethod: payment.method,
    },
  };

  const yyyymm = `${campaign.year}${String(campaign.month).padStart(2, '0')}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const receiptNo = `FV-${yyyymm}-${randomToken(4).toUpperCase()}`;
    const verificationRef = receiptVerificationRef({ receiptNo, voteId: vote._id, userId: vote.userId, celebrityId: celebrity._id });
    try {
      const [receipt] = await Receipt.create([{ ...base, receiptNo, verificationRef }], opts);
      return receipt;
    } catch (e) {
      if (e.code === 11000 && /receiptNo/.test(e.message)) continue; // number collision, retry
      throw e;
    }
  }
  throw new Error('Could not allocate a unique receipt number');
}

const publicReceipt = (r) => ({
  id: r._id, receiptNo: r.receiptNo, verificationRef: r.verificationRef, issuedAt: r.issuedAt,
  issuedAtIST: formatIST(r.issuedAt), ...r.snapshot.toObject?.() ?? r.snapshot,
  amountInr: (r.snapshot.amountPaise || 0) / 100,
  statement: 'This receipt corresponds to a recorded and confirmed FameVote voting transaction.',
});

/** Public verification: proves a receipt is genuine without exposing private details. */
async function verifyReceipt(receiptNo, ref) {
  const r = await Receipt.findOne({ receiptNo });
  const expected = r && receiptVerificationRef({ receiptNo, voteId: r.voteId, userId: r.userId, celebrityId: r.snapshot.celebrityId });
  if (!r || !ref || !safeEqual(String(ref).toUpperCase(), expected)) throw ApiError.notFound('No receipt matches that reference', 'RECEIPT_NOT_FOUND');
  return {
    valid: true, sample: Boolean(await User.exists({ _id: r.userId, authProviders: 'demo' })), receiptNo: r.receiptNo, issuedAt: r.issuedAt, celebrityName: r.snapshot.celebrityName,
    categoryName: r.snapshot.categoryName, campaign: r.snapshot.campaignLabel, amountInr: r.snapshot.amountPaise / 100,
  };
}

/* ------------------------------ fan-style PDF receipt ------------------------------ */
const C = { coral: '#FF6B3D', deep: '#D63E16', amber: '#FFB547', cream: '#FFF7EF', ink: '#18141E', mint: '#1F9D6B', gray: '#6B6470' };
const { fanLine, firstName, initials } = require('../data/fanCopy');
const env = require('../config/env');

function hashSeed(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function star(doc, cx, cy, r, rot = 0) {
  const pts = []; for (let i = 0; i < 10; i += 1) { const ang = rot + (Math.PI / 5) * i - Math.PI / 2; const rr = i % 2 ? r * 0.45 : r; pts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]); }
  doc.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(([x, y]) => doc.lineTo(x, y)); doc.closePath();
}
function fitName(doc, text, maxW, from = 34, to = 16) { for (let sz = from; sz >= to; sz -= 1) { doc.font('Helvetica-Bold').fontSize(sz); if (doc.widthOfString(text) <= maxW) return sz; } return to; }

async function qrBuffer(url) {
  try { return await require('qrcode').toBuffer(url, { margin: 0, width: 220, color: { dark: C.ink, light: '#FFFFFF' } }); } catch { return null; }
}

/** Streams a PDF receipt into `res`. Caller has already enforced ownership. */
async function streamReceiptPdf(r, res) {
  const s = r.snapshot; const rand = rng(hashSeed(r.receiptNo));
  const catSlug = (await Category.findById(s.categoryId).select('slug').lean().catch(() => null))?.slug;
  const verifyUrl = `${env.clientOrigins[0]}/verify-receipt?receiptNo=${encodeURIComponent(r.receiptNo)}&ref=${r.verificationRef}`;
  const qr = await qrBuffer(verifyUrl);
  const doc = new PDFDocument({ size: 'A5', margin: 0, info: { Title: `FameVote Receipt ${r.receiptNo}`, Author: 'FameVote', Subject: `Vote for ${s.celebrityName}` } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${r.receiptNo}.pdf"`);
  doc.pipe(res);
  const W = doc.page.width; const H = doc.page.height;

  doc.rect(0, 0, W, H).fill(C.cream);
  // Banner with a curved bottom edge
  doc.moveTo(0, 0).lineTo(W, 0).lineTo(W, 236).quadraticCurveTo(W / 2, 290, 0, 236).closePath().fill(C.coral);
  // Confetti (deterministic per receipt number, kept clear of the name block)
  const shades = ['#FFFFFF', C.amber, C.cream, C.deep, '#FFD28A'];
  for (let i = 0; i < 46; i += 1) {
    const x = rand() * W; const y = 8 + rand() * 120; const col = shades[Math.floor(rand() * shades.length)]; const sz = 3 + rand() * 6; const rot = rand() * Math.PI;
    if ((Math.abs(x - W / 2) < 52 && y > 58) || (x < 150 && y < 62)) continue;
    doc.save().fillColor(col).fillOpacity(0.85);
    const kind = Math.floor(rand() * 3);
    if (kind === 0) doc.circle(x, y, sz / 2).fill();
    else if (kind === 1) { doc.rotate((rot * 180) / Math.PI, { origin: [x, y] }).roundedRect(x - sz, y - sz / 3, sz * 2, sz * 0.66, 1.5).fill(); }
    else { star(doc, x, y, sz, rot); doc.fill(); }
    doc.restore();
  }
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(17).text('FameVote', 28, 24, { lineBreak: false });
  doc.fillOpacity(0.9).font('Helvetica-Bold').fontSize(7.5).text('FAN VOTE RECEIPT', 28, 46, { characterSpacing: 1.6, lineBreak: false }).fillOpacity(1);

  // Initials badge
  doc.circle(W / 2, 112, 46).fill('#FFFFFF');
  doc.circle(W / 2, 112, 40).fill(C.amber);
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(30).text(initials(s.celebrityName), 0, 98, { width: W, align: 'center', lineBreak: false });
  star(doc, W / 2 + 34, 78, 9, 0.3); doc.fillColor('#FFFFFF').fill();

  doc.fillColor('#FFFFFF').font('Helvetica-Oblique').fontSize(10.5).text(fanLine(catSlug, hashSeed(r.receiptNo)), 24, 172, { width: W - 48, align: 'center', lineBreak: false });
  const nm = String(s.celebrityName); const sz = fitName(doc, nm, W - 56);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(sz).text(nm, 28, 188, { width: W - 56, align: 'center', lineBreak: false });
  doc.fillOpacity(0.95).font('Helvetica').fontSize(10.5).text(`${s.categoryName}  |  ${s.campaignLabel}`, 24, 192 + sz, { width: W - 48, align: 'center', lineBreak: false }).fillOpacity(1);

  // Ticket card
  const cx = 24; const cw = W - 48; const cy = 276; const ch = 262;
  doc.save().fillColor(C.ink).fillOpacity(0.08).roundedRect(cx + 2, cy + 4, cw, ch, 16).fill().restore();
  doc.roundedRect(cx, cy, cw, ch, 16).fill('#FFFFFF');
  const perfY = cy + 150;
  doc.circle(cx, perfY, 9).fill(C.cream); doc.circle(cx + cw, perfY, 9).fill(C.cream);
  doc.save().dash(4, { space: 4 }).lineWidth(1).strokeColor('#E7D9CC').moveTo(cx + 14, perfY).lineTo(cx + cw - 14, perfY).stroke().undash().restore();

  const cell = (label, value, x, y, w) => {
    doc.fillColor(C.gray).font('Helvetica').fontSize(7.5).text(label.toUpperCase(), x, y, { width: w, characterSpacing: 0.8, lineBreak: false });
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10.5).text(String(value), x, y + 11, { width: w, height: 28, ellipsis: true });
  };
  const col1 = cx + 20; const col2 = cx + cw / 2 + 6; const cwid = cw / 2 - 28;
  cell('Date & time (IST)', formatIST(r.issuedAt), col1, cy + 20, cwid);
  cell('Paid', s.amountPaise ? `INR ${(s.amountPaise / 100).toFixed(2)}` : 'Free vote', col2, cy + 20, cwid);
  cell('Fan', `${s.userName}`, col1, cy + 62, cwid);
  cell('Fan state', s.stateName || '-', col2, cy + 62, cwid);
  cell('Celebrity ID', s.celebrityCode, col1, cy + 104, cwid);
  cell('Status', 'Counted', col2, cy + 104, cwid);
  doc.circle(col2 + 52, cy + 109, 4).fill(C.mint);

  // Stub: QR + numbers
  const sy = perfY + 16;
  if (qr) { doc.roundedRect(cx + 18, sy - 2, 88, 88, 8).lineWidth(1).strokeColor('#E7D9CC').stroke(); doc.image(qr, cx + 24, sy + 4, { width: 76, height: 76 }); }
  const tx = qr ? cx + 120 : cx + 20;
  doc.fillColor(C.gray).font('Helvetica').fontSize(7.5).text('RECEIPT NO.', tx, sy + 2, { characterSpacing: 0.8, lineBreak: false });
  doc.fillColor(C.deep).font('Courier-Bold').fontSize(15).text(r.receiptNo, tx, sy + 13, { lineBreak: false });
  doc.fillColor(C.gray).font('Helvetica').fontSize(7.5).text('VERIFICATION REF.', tx, sy + 38, { characterSpacing: 0.8, lineBreak: false });
  doc.fillColor(C.ink).font('Courier-Bold').fontSize(9.5).text(r.verificationRef, tx, sy + 49, { lineBreak: false });
  doc.fillColor(C.gray).font('Helvetica').fontSize(7.5).text(qr ? 'Scan the code to check this receipt, or enter the\nnumbers on the FameVote verify page.' : 'Enter these numbers on the FameVote verify page.', tx, sy + 66, { width: cw - (tx - cx) - 14 });

  // Rotated stamp over the banner edge
  doc.save().rotate(-11, { origin: [W - 92, 262] });
  doc.roundedRect(W - 156, 244, 128, 34, 8).lineWidth(2.5).fillAndStroke(C.cream, C.deep);
  doc.fillColor(C.deep).font('Helvetica-Bold').fontSize(12.5).text('VOTE COUNTED!', W - 156, 255, { width: 128, align: 'center', lineBreak: false });
  doc.restore();

  // Footer
  doc.fillColor(C.deep).font('Helvetica-Bold').fontSize(11.5).text(`Team ${firstName(s.celebrityName)}, forever!`, 0, H - 44, { width: W, align: 'center', lineBreak: false });
  doc.fillColor(C.gray).font('Helvetica').fontSize(6.8).text('This receipt corresponds to a recorded and confirmed FameVote voting transaction.', 24, H - 26, { width: W - 48, align: 'center', lineBreak: false });
  doc.end();
}

module.exports = { issueReceipt, publicReceipt, verifyReceipt, streamReceiptPdf };
