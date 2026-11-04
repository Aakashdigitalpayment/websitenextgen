'use strict';
/** Pure calculators for Nepali savings & credit products (all amounts in NPR, rates in % per year). */
const round = v => Math.round(v * 100) / 100;
const num = (v, d = 0, max = 1e12) => {
  const s = String(v ?? '').replace(/[, ]/g, '');
  if (s === '') return d;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : d;
};

/**
 * Fixed deposit maturity.
 * @param {{principal:number, rate:number, months:number, compounding:'monthly'|'quarterly'|'yearly'|'simple', tax:number}} o
 */
function fixedDeposit({ principal, rate, months, compounding = 'quarterly', tax = 0 }) {
  const per = { monthly: 12, quarterly: 4, yearly: 1 }[compounding];
  let gross;
  if (!per) gross = principal * (rate / 100) * (months / 12);
  else {
    const periods = months / (12 / per);
    gross = principal * ((1 + rate / 100 / per) ** periods - 1);
  }
  const taxAmt = gross * (tax / 100);
  return { gross: round(gross), tax: round(taxAmt), net: round(gross - taxAmt), maturity: round(principal + gross - taxAmt),
    effective: principal > 0 && months > 0 ? round(((principal + gross - taxAmt) / principal - 1) / (months / 12) * 100) : 0 };
}

/** Recurring (monthly) saving, interest on the monthly balance, credited every quarter (common co-op practice). */
function recurringSaving({ deposit, rate, months, tax = 0 }) {
  let bal = 0, accrued = 0, interest = 0, paid = 0;
  const rows = [];
  for (let m = 1; m <= months; m++) {
    bal += deposit; paid += deposit;
    accrued += bal * (rate / 100 / 12);
    if (m % 3 === 0 || m === months) {
      const net = accrued * (1 - tax / 100);
      bal += net; interest += net; accrued = 0;
    }
    if (m % 12 === 0 || m === months) rows.push({ month: m, paid: round(paid), interest: round(interest), balance: round(bal) });
  }
  return { paid: round(paid), interest: round(interest), maturity: round(bal), rows };
}

/** How much can I borrow? Debt-to-income based (EMI ≤ income × ratio − existing EMIs). */
function loanEligibility({ income, existing = 0, rate, months, ratio = 50 }) {
  const maxEmi = Math.max(0, income * (ratio / 100) - existing);
  const i = rate / 100 / 12;
  const amount = months > 0 ? (i ? maxEmi * (1 - (1 + i) ** -months) / i : maxEmi * months) : 0;
  return { maxEmi: round(maxEmi), amount: Math.floor(amount / 1000) * 1000, totalInterest: round(maxEmi * months - amount) };
}

module.exports = { fixedDeposit, recurringSaving, loanEligibility, num };
