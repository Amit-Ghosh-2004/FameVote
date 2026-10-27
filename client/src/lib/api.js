import axios from 'axios';

const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const root = `${base}/api`;

/** Cookie-authenticated clients. The custom header is the CSRF guard the server requires. */
export const api = axios.create({ baseURL: root, withCredentials: true, timeout: 20000, headers: { 'X-FV-Client': 'web' } });
export const adminApi = axios.create({ baseURL: `${root}/admin`, withCredentials: true, timeout: 30000, headers: { 'X-FV-Client': 'web' } });

export const errorMessage = (e, fallback = 'Something went wrong. Please try again.') =>
  e?.response?.data?.error?.message ||
  (e?.code === 'ECONNABORTED' ? 'The request timed out.' : e?.message === 'Network Error' ? 'Cannot reach the server.' : fallback);
export const errMsg = errorMessage;
export const errCode = (e) => e?.response?.data?.error?.code;

export const unwrap = (p) => p.then((r) => r.data.data);

export const inr = (n) => (n === 0 ? 'Free (₹0)' : `₹${Number(n).toFixed(n % 1 ? 2 : 0)}`);
export const fmtIST = (d) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
export const fmtNum = (n) => new Intl.NumberFormat('en-IN').format(n ?? 0);

/** Responsive, optimised Cloudinary delivery URL (non-Cloudinary URLs pass through). */
const isCld = (url) => typeof url === 'string' && url.includes('res.cloudinary.com') && url.includes('/upload/');
export function img(url, w = 400, extra = '') {
  if (!url) return null;
  return isCld(url) ? url.replace('/upload/', `/upload/f_auto,q_auto,c_fill,g_auto,ar_4:5,w_${w}${extra ? `,${extra}` : ''}/`) : url;
}
/** srcset of the same crop at several widths, so phones download ~12 KB instead of one 480px file for every avatar. */
export const imgSet = (url, widths = [160, 240, 360, 480, 720]) => (isCld(url) ? widths.map((w) => `${img(url, w)} ${w}w`).join(', ') : undefined);
/** A ~300 byte blurred preview shown instantly while the real image loads. */
export const imgTiny = (url) => (isCld(url) ? img(url, 24, 'q_30,e_blur:300') : null);
