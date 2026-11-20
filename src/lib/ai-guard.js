'use strict';
/**
 * Website assistant safety (port of includes/ai-chat-helpers.php, extended):
 * refuse questions about passwords / PINs / OTPs / balances / private member data and jailbreak attempts,
 * redact secrets from anything sent to the model, and block model answers that leak secrets or echo the system prompt.
 */

const JAILBREAK = [
  /ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|system)\s+(instructions|rules|prompts?)/i,
  /disregard\s+(all\s+|the\s+)?(previous|prior|above|system)/i,
  /(pretend|imagine)\s+(that\s+)?you\s+are|act\s+as\s+(if|an?\s+)|you\s+are\s+now\s+(a|an|in)\b|developer\s+mode|\bdan\s+mode|jailbreak/i,
  /bypass\s+(the\s+)?(security|rules|filters?|restrictions?)/i,
  /reveal\s+(your\s+|the\s+)?(hidden|secret|system|internal)|(show|print|repeat|reveal|tell)\s+(me\s+)?(your\s+|the\s+)?(system\s+prompt|instructions|prompt|rules)\b/i,
  /show\s+me\s+(the\s+)?(password|database|api\s*key|secret)/i,
  /नियम\s*बेवास्ता|निर्देशन\s*बेवास्ता|गोप्य\s*देखाउ|पासवर्ड\s*देखाउ|डाटाबेस\s*देखाउ/,
];

const SENSITIVE_EN = /\b(password|passwd|pass\s*word|pin\s*code|pin\s*number|\bpin\b|otp|one[\s-]?time\s*(password|code)|username|user\s*name|user\s*id|login\s*credentials?|admin\s*password|secret\s*key|api\s*key|private\s*key|access\s*token|auth\s*token|account\s*balance|balance\s*of|my\s*balance|account\s*number|member\s*number|share\s*number|kyc\s*documents?|kym\s*documents?|citizenship\s*(number|no)|national\s*id|bank\s*account\s*number|card\s*number|cvv|database\s*dump|sql\s*query|member\s*portal\s*password|member\s*data|private\s*data|sensitive\s*data|personal\s*data\s*of|phone\s*number\s*of\s*(a\s+|the\s+)?member|address\s*of\s*(a\s+|the\s+)?member)\b/i;
const SENSITIVE_NP = /पासवर्ड|पास्वर्ड|पिन\s*कोड|पिनकोड|पिन\s*नम्बर|ओटिपी|ओ\.टि\.पि|गोप्य|गुप्त|खाता\s*ब्यालेन्स|खाताको\s*ब्यालेन्स|मेरो\s*ब्यालेन्स|मौज्दात\s*कति|सदस्य\s*नम्बर|खाता\s*नम्बर|शेयर\s*नम्बर|नागरिकता\s*नम्बर|नागरिकता\s*नं|निजी\s*डाटा|निजी\s*सूचना|निजी\s*विवरण|मेरो\s*खाता|एडमिन\s*पासवर्ड|डाटाबेस/;

const strip = s => String(s || '').replace(/<[^>]*>/g, ' ').normalize('NFC');

function isJailbreak(message) {
  const q = strip(message);
  return JAILBREAK.some(re => re.test(q));
}

function isSensitive(message) {
  const q = strip(message);
  return isJailbreak(q) || SENSITIVE_EN.test(q) || SENSITIVE_NP.test(q);
}

function refusal(lang) {
  return lang === 'en'
    ? 'I can only share information published on this public website. Passwords, PINs, OTPs, usernames, account balances, KYM details and other private member data cannot be provided here. For your own account, use the member portal (/member/login) or contact staff (/contact).'
    : 'म यहाँ सार्वजनिक वेबसाइटमा रहेको जानकारी मात्र दिन्छु। पासवर्ड, पिन, OTP, प्रयोगकर्ता नाम, खाता ब्यालेन्स, केवाइएम वा अन्य गोप्य सदस्य विवरण यहाँबाट दिइँदैन। आफ्नो खातासम्बन्धी कुरा सदस्य पोर्टल (/member/login) बाट हेर्नुहोस् वा कर्मचारीसँग सम्पर्क (/contact) गर्नुहोस्।';
}

const SECRET = /(sk-[A-Za-z0-9_-]{10,}|AIza[A-Za-z0-9_-]{20,}|enc:v1:\S+|pii[123]:\S+|xox[abp]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\$2[aby]\$\d{2}\$[./A-Za-z0-9]{50,})/;

/** Remove secrets from text before it goes to the model or the visitor. */
function redact(text) {
  return String(text || '')
    .replace(new RegExp(SECRET.source, 'g'), '[redacted]')
    .replace(/\b(password|passwd|pin|otp|api[\s_-]?key|secret)\s*[:=]\s*\S+/gi, '$1: [redacted]');
}

/** Model output that contains a secret, a password/PIN value or a member balance. */
function answerLeaks(answer) {
  const a = String(answer || '');
  if (SECRET.test(a)) return true;
  if (/\b(password|passwd|pin|otp)\s*(is|:|=)\s*\S+/i.test(a)) return true;
  if (/\byour\s+(account|member|saving)s?\s+balance\s+(is|:)|खाताको\s*ब्यालेन्स\s*[:=]|मेरो\s*ब्यालेन्स\s*[:=]|ब्यालेन्स\s*रु\.?\s*[0-9०-९]/i.test(a)) return true;
  return false;
}

/** The model echoed its instructions instead of answering. */
function looksLikePromptLeak(answer) {
  const a = String(answer || '');
  return /\b(STRICT RULES|SITE CONTEXT|PUBLIC PAGES|system (instruction|prompt)|never invent|Use ONLY the facts below|You are the helpful website assistant)\b/i.test(a)
    || /PAGES below|plain text only\s*\(no markdown|Rule\s*\d+\s*:/i.test(a);
}

module.exports = { isSensitive, isJailbreak, refusal, redact, answerLeaks, looksLikePromptLeak };
