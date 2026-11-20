'use strict';
/**
 * Auction bidding window (includes/auction-tables.php auctionEndTimestamp / auctionIsOpenForBids):
 * open = active, status upcoming/ongoing, and Nepal time not past auction_date + auction_time.
 */
const NPT_OFFSET_MIN = 345; // Asia/Kathmandu, UTC+05:45, no DST

/** End of bidding as a JS timestamp, or null when the auction has no (valid) date. */
function endTimestamp(a) {
  const date = String(a?.auction_date || '').slice(0, 10);
  const d = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!d) return null;
  const t = String(a.auction_time || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
  let h = 23, mi = 59, s = 59;
  if (t) {
    h = Number(t[1]); mi = Number(t[2]); s = Number(t[3] || 0);
    if (t[4]) { const pm = /p/i.test(t[4]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    if (h > 23 || mi > 59 || s > 59) { h = 23; mi = 59; s = 59; }
  }
  return Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), h, mi, s) - NPT_OFFSET_MIN * 60_000;
}

function isOpen(a, now = Date.now()) {
  if (!a || !Number(a.is_active)) return false;
  if (!['upcoming', 'ongoing'].includes(String(a.status || ''))) return false;
  const end = endTimestamp(a);
  return end === null || now <= end;
}

module.exports = { endTimestamp, isOpen };
