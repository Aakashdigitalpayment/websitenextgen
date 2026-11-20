'use strict';
/**
 * Website assistant: instant answers from chatbot_faqs/faqs first, then (if configured)
 * an LLM provider with the cooperative's own facts as context.
 * Providers match the PHP app: Gemini, OpenAI, DeepSeek (key + model in tenant settings).
 */
const db = require('../db');
const settings = require('./settings');
const util = require('./util');
const guard = require('./ai-guard');

/** Settings (PHP key names such as ai_chat_enabled and the enc:v1: key are mapped by settings.js at read time). */
const aiSettings = () => settings.all();

const DEFAULT_MODEL = { gemini: 'gemini-2.5-flash', openai: 'gpt-4o-mini', deepseek: 'deepseek-chat' };

const norm = s => String(s || '').toLowerCase().replace(/[?।!,.:;"'()]/g, ' ').replace(/\s+/g, ' ').trim();
const words = s => norm(s).split(' ').filter(w => w.length > 1);

/** Best FAQ match by keyword hits and word overlap; returns { answer, score } or null. */
async function instantAnswer(message, lang) {
  const q = norm(message);
  const qWords = new Set(words(message));
  if (!qWords.size) return null;
  const rows = [
    ...(await db.many('SELECT question, question_en, answer, answer_en, keywords FROM chatbot_faqs WHERE is_active = 1')),
    ...(await db.many('SELECT question_np AS question, question AS question_en, answer_np AS answer, answer AS answer_en, category AS keywords FROM faqs WHERE is_active = 1')),
  ];
  let best = null;
  for (const r of rows) {
    let score = 0;
    for (const k of String(r.keywords || '').split(',').map(norm).filter(Boolean)) if (q.includes(k)) score += 3;
    const qw = new Set([...words(r.question), ...words(r.question_en)]);
    let overlap = 0;
    for (const w of qWords) if (qw.has(w)) overlap++;
    score += overlap / Math.max(3, qWords.size) * 4;
    if (!best || score > best.score) best = { score, row: r };
  }
  if (!best || best.score < 2) return null;
  const a = lang === 'en' ? best.row.answer_en || best.row.answer : best.row.answer || best.row.answer_en;
  return a ? { answer: util.stripTags(a), score: best.score } : null;
}

/** Instant answers from the site's own data (ai-chat-instant.php): CEO / chairman, interest rates, member count. */
async function dataAnswer(message, lang) {
  const q = norm(message), en = lang === 'en';
  const s = await aiSettings();
  const who = /\b(ceo|chief executive|manager)\b|प्रमुख\s*कार्यकारी|सीईओ|प्रबन्धक/i.test(q) ? 'ceo' : /\b(chair(man|person)?|president)\b|अध्यक्ष/i.test(q) && !/उपाध्यक्ष|vice/i.test(q) ? 'chairman' : null;
  if (who) {
    const l = await require('./team').leader(who, s, lang);
    if (l && l.name) {
      const bits = [en ? `Our ${l.designation} is ${l.name}.` : `हाम्रो ${l.designation} ${l.name} हुनुहुन्छ।`];
      if (l.message) bits.push(en ? `Read the message: ${l.href}` : `सन्देश: ${l.href}`);
      return { answer: bits.join(' '), source: 'data', links: [l.href] };
    }
  }
  if (/interest|rate|byaj|ब्याज|ब्याजदर/i.test(q)) {
    const rates = await db.many('SELECT category, name, name_np, rate FROM interest_rates WHERE is_active = 1 ORDER BY category DESC, display_order, id LIMIT 12');
    if (rates.length) {
      const fmt = cat => rates.filter(r => r.category === cat).slice(0, 6).map(r => `${en ? r.name || r.name_np : r.name_np || r.name} ${Number(r.rate)}%`).join(', ');
      const sv = fmt('saving'), ln = fmt('loan');
      const ans = en ? [sv && `Saving: ${sv}.`, ln && `Loan: ${ln}.`, 'Full list: /interest-rates'] : [sv && `बचत: ${sv}।`, ln && `ऋण: ${ln}।`, 'पूरा सूची: /interest-rates'];
      return { answer: ans.filter(Boolean).join(' '), source: 'data', links: ['/interest-rates'] };
    }
  }
  if (/how many members|member count|total members|कति\s*(जना\s*)?सदस्य|सदस्य\s*संख्या/i.test(q)) {
    const n = await db.value("SELECT total_members FROM institutional_profile WHERE is_active = 1 AND access_level = 'none' AND total_members > 0 ORDER BY fiscal_year DESC, report_month DESC NULLS LAST, id DESC LIMIT 1");
    if (n) return { answer: en ? `We have ${Number(n).toLocaleString('en-IN')} members (latest institutional profile).` : `हाम्रो सहकारीमा ${Number(n).toLocaleString('en-IN')} सदस्य हुनुहुन्छ (पछिल्लो संस्थागत विवरण)।`, source: 'data', links: ['/institutional-profile'] };
  }
  return null;
}

/** Public content scored by word overlap with the question (ai_chat_collect_candidates), kept within ~5,200 characters. */
async function retrieve(message) {
  const qw = new Set(words(message).filter(w => w.length > 2));
  if (!qw.size) return [];
  const [news, notices, pages, products, downloads, careers] = await Promise.all([
    db.many('SELECT title, title_np, content, content_np FROM news WHERE is_active = 1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 40'),
    db.many('SELECT title, title_np, content, content_np FROM notices WHERE is_active = 1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 40'),
    db.many('SELECT title, title_np, content, content_np FROM pages WHERE is_active = 1 LIMIT 40'),
    db.many('SELECT name, name_np, description, description_np FROM service_products WHERE is_active = 1 LIMIT 60').catch(() => []),
    db.many('SELECT title, title_np FROM downloads WHERE is_active = 1 AND deleted_at IS NULL LIMIT 40'),
    db.many('SELECT title, title_np, department, deadline FROM careers WHERE is_active = 1 AND deleted_at IS NULL LIMIT 20'),
  ]);
  const cands = [
    ...news.map(r => ['News', r.title_np || r.title, r.content_np || r.content]), ...notices.map(r => ['Notice', r.title_np || r.title, r.content_np || r.content]),
    ...pages.map(r => ['Page', r.title_np || r.title, r.content_np || r.content]), ...products.map(r => ['Product', r.name_np || r.name, r.description_np || r.description]),
    ...downloads.map(r => ['Download', r.title_np || r.title, '']), ...careers.map(r => ['Job', r.title_np || r.title, [r.department, r.deadline].filter(Boolean).join(' ')]),
  ].map(([kind, title, body]) => {
    const text = util.stripTags(body || '');
    const tw = new Set(words(title + ' ' + text.slice(0, 1500)));
    let score = 0;
    for (const w of qw) if (tw.has(w)) score++;
    return { score, line: `${kind}: ${title}${text ? ' — ' + util.excerpt(text, 400) : ''}` };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score);
  const out = [];
  let size = 0;
  for (const c of cands) { if (size + c.line.length > 5200) break; out.push(c.line); size += c.line.length; }
  return out;
}

async function context(lang, message = '') {
  const s = await aiSettings();
  const [rates, services, faqs, centers] = await Promise.all([
    db.many('SELECT category, name, name_np, rate FROM interest_rates WHERE is_active = 1 ORDER BY category, display_order LIMIT 30'),
    db.many('SELECT title, title_np, description_np, description FROM services WHERE is_active = 1 ORDER BY display_order LIMIT 20'),
    db.many('SELECT question, answer FROM chatbot_faqs WHERE is_active = 1 ORDER BY display_order LIMIT 30'),
    db.many('SELECT name, name_np, address, phone, opening_hours FROM service_centers WHERE is_active = 1 ORDER BY is_main_branch DESC LIMIT 10'),
  ]);
  const lines = [
    `Organisation: ${s.site_name || ''} (${s.site_name_en || ''}), a savings and credit cooperative in Nepal.`,
    s.address && `Address: ${s.address}`, s.phone && `Phone: ${s.phone}`, s.email && `Email: ${s.email}`, s.working_hours && `Office hours: ${s.working_hours}`,
    s.about_short && `About: ${util.stripTags(s.about_short)}`,
    rates.length && 'Interest rates (% per year): ' + rates.map(r => `${r.category === 'loan' ? 'Loan' : 'Saving'} – ${r.name_np || r.name}: ${r.rate}%`).join('; '),
    services.length && 'Services: ' + services.map(x => `${x.title_np || x.title}: ${util.excerpt(x.description_np || x.description, 140)}`).join(' | '),
    centers.length && 'Branches: ' + centers.map(c => `${c.name_np || c.name}, ${c.address || ''} ${c.phone || ''} ${c.opening_hours || ''}`).join(' | '),
    faqs.length && 'Known answers: ' + faqs.map(f => `Q: ${f.question} A: ${util.stripTags(f.answer)}`).join(' | '),
    s.ai_extra_context && `Extra: ${s.ai_extra_context}`,
    ...(await retrieve(message)).map(l => 'Relevant: ' + l),
    'Website pages: /apply/account (open account), /apply/loan, /apply/kyc, /apply/grievance, /apply/appointment, /track (application status), /interest-rates, /emi-calculator, /contact, /member/login.',
  ].filter(Boolean);
  return `You are the helpful website assistant for this cooperative. Answer in ${lang === 'en' ? 'English' : 'Nepali (Devanagari)'} unless the user writes in another language, in 1–4 short sentences.
Use ONLY the facts below. If you do not know (e.g. account balances, personal data, loan approval decisions), say so and give the phone number or the relevant website page. Never ask for passwords, PINs or OTPs. Never invent rates or fees.

${guard.redact(lines.join('\n'))}`;
}

async function httpJson(url, headers, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || 'HTTP ' + r.status);
    return j;
  } finally { clearTimeout(timer); }
}

async function askProvider(provider, apiKey, model, system, history, message) {
  const msgs = [...history.slice(-6), { role: 'user', content: message }];
  if (provider === 'openai' || provider === 'deepseek') {
    const url = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.deepseek.com/v1/chat/completions';
    const j = await httpJson(url, { authorization: 'Bearer ' + apiKey }, { model, temperature: 0.3, max_tokens: 400, messages: [{ role: 'system', content: system }, ...msgs] });
    return j.choices?.[0]?.message?.content || '';
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const j = await httpJson(url, { 'x-goog-api-key': apiKey }, {
    systemInstruction: { parts: [{ text: system }] },
    contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: { temperature: 0.3, maxOutputTokens: 400 },
  });
  return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
}

const usage = new Map(); // "<schema>:<YYYY-MM-DD>" -> AI calls today (per process)
function underBudget(limit) {
  const key = db.currentSchema() + ':' + new Date().toISOString().slice(0, 10);
  const n = usage.get(key) || 0;
  if (n >= limit) return false;
  if (usage.size > 500) usage.clear();
  usage.set(key, n + 1);
  return true;
}

/** @returns {Promise<{answer:string, source:'faq'|'ai'|'fallback'}>} history comes from the server-side session only */
async function reply(message, history = [], lang = 'np') {
  const s = await aiSettings();
  const links = suggestLinks(message);
  // refuse requests for passwords, PINs, balances, private member data and jailbreak attempts before anything else
  if (guard.isSensitive(message)) return { answer: guard.refusal(lang), source: 'guard', links: ['/member/login', '/contact'] };
  const data = await dataAnswer(message, lang);
  if (data) return data;
  const instant = await instantAnswer(message, lang);
  if (instant && instant.score >= 3) return { answer: guard.redact(instant.answer), source: 'faq', links };
  const provider = ['gemini', 'openai', 'deepseek'].includes(s.ai_provider) ? s.ai_provider : 'gemini';
  if (s.ai_enabled === '1' && s.ai_api_key && underBudget(Number(s.ai_daily_limit) || 300)) {
    try {
      const clean = history.filter(h => h && ['user', 'assistant'].includes(h.role) && typeof h.content === 'string').map(h => ({ role: h.role, content: guard.redact(h.content.slice(0, 1000)) }));
      const text = (await askProvider(provider, s.ai_api_key, s.ai_model || DEFAULT_MODEL[provider], await context(lang, message), clean, guard.redact(message))).trim();
      // post-checks: never pass on a leaked secret / balance or an echo of the instructions
      if (text && !guard.answerLeaks(text) && !guard.looksLikePromptLeak(text)) return { answer: guard.redact(text).slice(0, 2000), source: 'ai', links };
    } catch (e) { console.error('ai-chat:', e.message); }
  }
  if (instant) return { answer: guard.redact(instant.answer), source: 'faq', links };
  const phone = s.phone ? (lang === 'en' ? ` Call us on ${s.phone}.` : ` फोन: ${s.phone}`) : '';
  return { answer: (lang === 'en' ? 'Sorry, I could not find an answer. Please see our FAQs or contact the office.' : 'माफ गर्नुहोस्, उत्तर भेटिएन। FAQ हेर्नुहोस् वा कार्यालयमा सम्पर्क गर्नुहोस्।') + phone, source: 'fallback', links: links.length ? links : ['/faqs', '/contact'] };
}

/** Up to 3 site pages that match the question's words (shown as chips under the answer). */
function suggestLinks(message) {
  const idx = require('./search-index');
  const seen = new Set();
  for (const w of words(message)) for (const p of idx.match(w)) { if (seen.size < 3) seen.add(p.href); }
  return [...seen];
}

module.exports = { reply, instantAnswer, dataAnswer, context, retrieve, suggestLinks, DEFAULT_MODEL };
