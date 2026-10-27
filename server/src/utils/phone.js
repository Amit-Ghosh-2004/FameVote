/** Phone numbers are stored in E.164 (+<country><number>). A bare 10-digit number is treated as an Indian mobile. */
function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/[\s().-]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) {
    if (/^0?[6-9]\d{9}$/.test(s)) s = `+91${s.replace(/^0/, '')}`;
    else if (/^91[6-9]\d{9}$/.test(s)) s = `+${s}`;
    else return null;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  if (s.startsWith('+91') && !/^\+91[6-9]\d{9}$/.test(s)) return null; // Indian mobiles only start with 6-9
  return s;
}
const maskPhone = (p = '') => (p.length > 6 ? `${p.slice(0, 3)}${'*'.repeat(p.length - 6)}${p.slice(-3)}` : '***');
/** Phone-only accounts still need a unique e-mail (existing unique index), so they get a reserved, non-routable one. */
const PHONE_EMAIL_DOMAIN = 'phone.famevote.invalid';
const placeholderEmail = (phone) => `${phone.replace('+', 'p')}@${PHONE_EMAIL_DOMAIN}`;
const isPlaceholderEmail = (e = '') => e.endsWith(`@${PHONE_EMAIL_DOMAIN}`);
/** Masked contact for receipts and admin lists: a masked phone for phone-only accounts, otherwise the e-mail as stored. */
const phoneFromPlaceholder = (e) => `+${e.split('@')[0].slice(1)}`;
const contactOf = (email = '', maskFn) => (isPlaceholderEmail(email) ? maskPhone(phoneFromPlaceholder(email)) : maskFn ? maskFn(email) : email);
module.exports = { contactOf, normalizePhone, maskPhone, placeholderEmail, isPlaceholderEmail, PHONE_EMAIL_DOMAIN };
