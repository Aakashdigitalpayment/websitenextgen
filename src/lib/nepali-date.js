'use strict';
/**
 * Bikram Sambat (BS) ⇄ Gregorian (AD) conversion.
 * Month lengths: bs-month-days.json (same source as the PHP app, BS 1970–2100).
 * Reference point: BS 2000-09-17 = AD 1944-01-01.
 */
const MONTH_DAYS = require('./bs-month-days.json');

const MIN_YEAR = 1970, MAX_YEAR = 2100;
const REF_BS = [2000, 9, 17];
const REF_AD_UTC = Date.UTC(1944, 0, 1);
const DAY = 86_400_000;

const MONTHS_NP = ['बैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज', 'कात्तिक', 'मंसिर', 'पुस', 'माघ', 'फागुन', 'चैत'];
const MONTHS_EN = ['Baishakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];
const WEEKDAYS_NP = ['आइतबार', 'सोमबार', 'मंगलबार', 'बुधबार', 'बिहीबार', 'शुक्रबार', 'शनिबार'];

function monthLengths(year) { return MONTH_DAYS[year] || null; }

function isValidBs(y, m, d) {
  const lens = monthLengths(y);
  return !!lens && m >= 1 && m <= 12 && d >= 1 && d <= lens[m - 1];
}

/** Days from BS 1970-01-01 to the given BS date. */
function bsOrdinal(y, m, d) {
  let n = 0;
  for (let yy = MIN_YEAR; yy < y; yy++) n += MONTH_DAYS[yy].reduce((a, b) => a + b, 0);
  for (let mm = 1; mm < m; mm++) n += MONTH_DAYS[y][mm - 1];
  return n + d - 1;
}
const REF_ORD = bsOrdinal(...REF_BS);

function bsFromOrdinal(n) {
  let y = MIN_YEAR;
  while (y <= MAX_YEAR) {
    const yearDays = MONTH_DAYS[y].reduce((a, b) => a + b, 0);
    if (n < yearDays) break;
    n -= yearDays; y++;
  }
  if (y > MAX_YEAR || n < 0) return null;
  let m = 1;
  while (n >= MONTH_DAYS[y][m - 1]) { n -= MONTH_DAYS[y][m - 1]; m++; }
  return [y, m, n + 1];
}

const pad = n => String(n).padStart(2, '0');
const fmt = ([y, m, d]) => `${y}-${pad(m)}-${pad(d)}`;

function parse(s) {
  const m = String(s || '').trim().replace(/[०-९]/g, c => '०१२३४५६७८९'.indexOf(c)).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** 'YYYY-MM-DD' BS → 'YYYY-MM-DD' AD (null if invalid / out of range) */
function bsToAd(bs) {
  const p = parse(bs);
  if (!p || !isValidBs(...p)) return null;
  const t = new Date(REF_AD_UTC + (bsOrdinal(...p) - REF_ORD) * DAY);
  return fmt([t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]);
}

/** 'YYYY-MM-DD' AD (or Date) → 'YYYY-MM-DD' BS */
function adToBs(ad) {
  let utc;
  if (ad instanceof Date) utc = Date.UTC(ad.getFullYear(), ad.getMonth(), ad.getDate());
  else {
    const p = parse(ad);
    if (!p) return null;
    utc = Date.UTC(p[0], p[1] - 1, p[2]);
  }
  const bs = bsFromOrdinal(REF_ORD + Math.round((utc - REF_AD_UTC) / DAY));
  return bs ? fmt(bs) : null;
}

/** Today in Kathmandu (UTC+5:45) as BS */
function todayBs() {
  const k = new Date(Date.now() + (5 * 60 + 45) * 60_000);
  return adToBs(`${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`);
}

function toNepaliDigits(s) { return String(s ?? '').replace(/[0-9]/g, d => '०१२३४५६७८९'[d]); }
function toLatinDigits(s) { return String(s ?? '').replace(/[०-९]/g, c => '०१२३४५६७८९'.indexOf(c)); }

/** '2081-05-12' → '१२ भदौ २०८१' */
function formatBs(bs, lang = 'np') {
  const p = parse(bs);
  if (!p) return '';
  if (lang === 'en') return `${p[2]} ${MONTHS_EN[p[1] - 1]} ${p[0]}`;
  return `${toNepaliDigits(p[2])} ${MONTHS_NP[p[1] - 1]} ${toNepaliDigits(p[0])}`;
}

/** Calendar grid for a BS month: { year, month, days, startWeekday, adStart } */
function monthGrid(y, m) {
  if (!isValidBs(y, m, 1)) return null;
  const adStart = bsToAd(fmt([y, m, 1]));
  const [ay, am, ad] = adStart.split('-').map(Number);
  return { year: y, month: m, days: MONTH_DAYS[y][m - 1], startWeekday: new Date(Date.UTC(ay, am - 1, ad)).getUTCDay(), adStart };
}

module.exports = {
  bsToAd, adToBs, todayBs, isValidBs, monthLengths, formatBs, monthGrid, parse,
  toNepaliDigits, toLatinDigits, MONTHS_NP, MONTHS_EN, WEEKDAYS_NP, MIN_YEAR, MAX_YEAR,
};
