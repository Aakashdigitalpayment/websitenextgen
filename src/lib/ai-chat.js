'use strict';
/**
 * Website assistant: instant answers from chatbot_faqs/faqs first, then (if configured)
 * an LLM provider with the cooperative's own facts as context.
 * Providers match the PHP app: Gemini, OpenAI, DeepSeek (key + model in tenant settings).
 */
const db = require('../db');
const settings = require('./settings');
const util = require('./util');

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

async function context(lang) {
  const s = await settings.all();
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
    'Website pages: /apply/account (open account), /apply/loan, /apply/kyc, /apply/grievance, /apply/appointment, /track (application status), /interest-rates, /emi-calculator, /contact, /member/login.',
  ].filter(Boolean);
  return `You are the helpful website assistant for this cooperative. Answer in ${lang === 'en' ? 'English' : 'Nepali (Devanagari)'} unless the user writes in another language, in 1–4 short sentences.
Use ONLY the facts below. If you do not know (e.g. account balances, personal data, loan approval decisions), say so and give the phone number or the relevant website page. Never ask for passwords, PINs or OTPs. Never invent rates or fees.

${lines.join('\n')}`;
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

/** @returns {Promise<{answer:string, source:'faq'|'ai'|'fallback'}>} */
async function reply(message, history = [], lang = 'np') {
  const s = await settings.all();
  const instant = await instantAnswer(message, lang);
  if (instant && instant.score >= 3) return { answer: instant.answer, source: 'faq' };
  const provider = ['gemini', 'openai', 'deepseek'].includes(s.ai_provider) ? s.ai_provider : 'gemini';
  if (s.ai_enabled === '1' && s.ai_api_key) {
    try {
      const clean = history.filter(h => h && ['user', 'assistant'].includes(h.role) && typeof h.content === 'string').map(h => ({ role: h.role, content: h.content.slice(0, 1000) }));
      const text = await askProvider(provider, s.ai_api_key, s.ai_model || DEFAULT_MODEL[provider], await context(lang), clean, message);
      if (text.trim()) return { answer: text.trim().slice(0, 2000), source: 'ai' };
    } catch (e) { console.error('ai-chat:', e.message); }
  }
  if (instant) return { answer: instant.answer, source: 'faq' };
  const phone = s.phone ? (lang === 'en' ? ` Call us on ${s.phone}.` : ` फोन: ${s.phone}`) : '';
  return { answer: (lang === 'en' ? 'Sorry, I could not find an answer. Please see our FAQs or contact the office.' : 'माफ गर्नुहोस्, उत्तर भेटिएन। FAQ हेर्नुहोस् वा कार्यालयमा सम्पर्क गर्नुहोस्।') + phone, source: 'fallback' };
}

module.exports = { reply, instantAnswer, context, DEFAULT_MODEL };
