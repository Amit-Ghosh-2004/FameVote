/**
 * IST (Asia/Kolkata) helpers. IST is a fixed UTC+05:30 offset with no DST, so plain
 * offset arithmetic is exact and independent of the server's own timezone.
 *
 * Campaign rule (documented, server-side only):
 *   startsAt = 00:00:00.000 IST on day 1 of the month
 *   endsAt   = <cutoff>.999 IST on the SECOND-LAST calendar day of the month
 *   The last day of the month is results day (voting is closed, results are finalized and shown);
 *   the next campaign opens at 00:00 IST on day 1 of the next month.
 *   A vote/payment is accepted iff startsAt <= t <= endsAt.
 */
const IST_OFFSET_MS = 330 * 60 * 1000;

function istParts(date = new Date()) {
  const d = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

const campaignKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

function nextMonth(year, month) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function prevMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function campaignWindow(year, month, cutoff = '23:59:59') {
  const [h, m, s] = cutoff.split(':').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); // handles leap years
  const startsAt = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - IST_OFFSET_MS);
  const endsAt = new Date(Date.UTC(year, month - 1, lastDay - 1, h, m, s, 999) - IST_OFFSET_MS); // results day = last day
  return { startsAt, endsAt };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const monthLabel = (year, month) => `${MONTHS[month - 1]} ${year}`;

function formatIST(date) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium',
    hour12: true,
  }).format(new Date(date));
}

module.exports = {
  IST_OFFSET_MS, istParts, campaignKey, nextMonth, prevMonth, campaignWindow, monthLabel, formatIST,
};
