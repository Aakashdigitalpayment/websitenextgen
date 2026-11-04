'use strict';
/** Built-in hero illustrations for starter slides, drawn in the visitor's current theme colour. */
const HEX = /^#[0-9a-f]{6}$/i;

const frame = (c, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".16"/><stop offset="1" stop-color="${c}" stop-opacity=".04"/></linearGradient>
  <linearGradient id="br" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity=".78"/></linearGradient>
</defs>
<rect width="800" height="600" fill="#f7f7f5"/><rect width="800" height="600" fill="url(#bg)"/>
<circle cx="680" cy="110" r="150" fill="${c}" opacity=".07"/><circle cx="90" cy="540" r="190" fill="${c}" opacity=".06"/>
${inner}
</svg>`;

const person = (x, y, s, c, shirt) => `<g transform="translate(${x} ${y}) scale(${s})">
  <circle cx="0" cy="-118" r="30" fill="#e9c4a4"/><path d="M-30 -128a30 30 0 0 1 60 0c0-22-14-34-30-34s-30 12-30 34z" fill="#2b2b2b"/>
  <path d="M-52 0v-46a52 52 0 0 1 104 0V0z" fill="${shirt || c}"/></g>`;

const ART = {
  saving: c => frame(c, `
  <rect x="150" y="430" width="500" height="14" rx="7" fill="${c}" opacity=".18"/>
  ${[0, 1, 2, 3].map(i => `<g transform="translate(${190 + i * 95} 0)">${Array.from({ length: i + 2 }, (_, j) => `<rect x="0" y="${404 - j * 26}" width="70" height="22" rx="11" fill="url(#br)" opacity="${0.55 + j * 0.1}"/>`).join('')}</g>`).join('')}
  <path d="M190 300 C300 260 360 230 430 200 S560 140 620 110" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round"/>
  <path d="M590 96l40 8-14 38" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="560" cy="250" r="54" fill="#fff" stroke="${c}" stroke-width="8"/><text x="560" y="270" text-anchor="middle" font-family="Inter,Arial" font-size="54" font-weight="600" fill="${c}">रु</text>`),
  loan: c => frame(c, `
  <rect x="200" y="250" width="300" height="200" rx="14" fill="#fff" stroke="${c}" stroke-width="6"/>
  <path d="M190 260 L350 160 L510 260" fill="${c}" opacity=".9"/>
  <rect x="235" y="300" width="70" height="60" rx="6" fill="${c}" opacity=".22"/><rect x="395" y="300" width="70" height="60" rx="6" fill="${c}" opacity=".22"/>
  <rect x="320" y="340" width="60" height="110" rx="6" fill="${c}" opacity=".55"/>
  <rect x="235" y="216" width="230" height="26" rx="6" fill="#fff"/><text x="350" y="236" text-anchor="middle" font-family="Inter,Arial" font-size="18" font-weight="600" fill="${c}">पसल · SHOP</text>
  <g transform="translate(560 300)"><rect width="150" height="190" rx="12" fill="#fff" stroke="${c}" stroke-width="5"/>
    <rect x="22" y="26" width="106" height="12" rx="6" fill="${c}"/><rect x="22" y="56" width="80" height="10" rx="5" fill="#d4d4d0"/><rect x="22" y="80" width="96" height="10" rx="5" fill="#d4d4d0"/>
    <path d="M40 140l22 22 48-50" fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></g>
  <rect x="150" y="450" width="580" height="12" rx="6" fill="${c}" opacity=".18"/>`),
  digital: c => frame(c, `
  <rect x="300" y="90" width="210" height="410" rx="34" fill="#1c1f23"/><rect x="314" y="118" width="182" height="352" rx="20" fill="#fff"/>
  <rect x="334" y="142" width="142" height="70" rx="12" fill="url(#br)"/><text x="350" y="172" font-family="Inter,Arial" font-size="15" fill="#fff" opacity=".85">मौज्दात</text><text x="350" y="198" font-family="Inter,Arial" font-size="22" font-weight="600" fill="#fff">रु ४५,२००</text>
  ${[0, 1, 2].map(i => `<rect x="${334 + i * 50}" y="232" width="40" height="40" rx="10" fill="${c}" opacity=".16"/>`).join('')}
  <g transform="translate(355 300)" fill="${c}"><rect width="100" height="100" rx="8" fill="#fff" stroke="${c}" stroke-width="4"/>
    <rect x="12" y="12" width="26" height="26"/><rect x="62" y="12" width="26" height="26"/><rect x="12" y="62" width="26" height="26"/><rect x="50" y="50" width="12" height="12"/><rect x="70" y="66" width="18" height="12"/><rect x="62" y="80" width="10" height="10"/></g>
  <rect x="334" y="420" width="142" height="30" rx="15" fill="${c}"/>
  <circle cx="600" cy="200" r="46" fill="#fff" stroke="${c}" stroke-width="6"/><path d="M580 200l14 14 26-28" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M180 260h80M200 300h60M170 340h90" stroke="${c}" stroke-width="10" stroke-linecap="round" opacity=".4"/>`),
  farm: c => frame(c, `
  <circle cx="610" cy="150" r="56" fill="#f5b942" opacity=".9"/>
  <path d="M0 420 C160 360 300 380 420 410 S650 440 800 400 V600 H0z" fill="${c}" opacity=".35"/>
  <path d="M0 470 C200 430 380 450 520 470 S700 490 800 470 V600 H0z" fill="${c}" opacity=".6"/>
  ${[0, 1, 2, 3, 4, 5].map(i => `<g transform="translate(${150 + i * 90} ${430 - (i % 2) * 10})"><path d="M0 0V-90" stroke="${c}" stroke-width="6"/><path d="M0-40c-30-6-40-26-40-26 26-4 40 10 40 26zM0-62c30-6 40-26 40-26-26-4-40 10-40 26z" fill="${c}"/><ellipse cx="0" cy="-100" rx="9" ry="16" fill="#e0a526"/></g>`).join('')}
  <g transform="translate(250 250)"><rect x="-70" y="-60" width="140" height="100" fill="#fff" stroke="${c}" stroke-width="5"/><path d="M-85 -55 L0 -120 L85 -55z" fill="${c}"/><rect x="-18" y="-10" width="36" height="50" fill="${c}" opacity=".5"/></g>`),
  community: c => frame(c, `
  <ellipse cx="400" cy="470" rx="300" ry="26" fill="${c}" opacity=".14"/>
  ${person(250, 470, 1.05, c, '#64748b')}${person(400, 470, 1.25, c)}${person(550, 470, 1.05, c, '#a16207')}
  ${person(325, 470, .8, c, '#be7c96')}${person(475, 470, .8, c, '#4b8a6b')}
  <g transform="translate(400 150)"><path d="M0 40C-60 0-60-50-25-60c15-4 25 6 25 16 0-10 10-20 25-16 35 10 35 60-25 100z" fill="${c}"/></g>`),
  women: c => frame(c, `
  <rect x="470" y="200" width="220" height="230" rx="16" fill="#fff" stroke="${c}" stroke-width="5"/>
  <rect x="495" y="230" width="170" height="16" rx="8" fill="${c}"/>${[0, 1, 2, 3].map(i => `<rect x="495" y="${270 + i * 34}" width="${90 + (i % 2) * 50}" height="12" rx="6" fill="#d4d4d0"/><circle cx="650" cy="${276 + i * 34}" r="8" fill="${c}" opacity="${0.35 + i * 0.15}"/>`).join('')}
  ${person(230, 470, 1.2, c)}${person(350, 470, 1.05, c, '#c2410c')}
  <g transform="translate(150 250)" fill="${c}" opacity=".85"><circle r="22"/><rect x="-6" y="18" width="12" height="40"/><rect x="-22" y="34" width="44" height="10"/></g>
  <ellipse cx="420" cy="470" rx="320" ry="22" fill="${c}" opacity=".14"/>`),
};

function render(name, color) {
  const fn = ART[name];
  if (!fn) return null;
  return fn(HEX.test(color || '') ? color : '#0f766e');
}

module.exports = { render, names: Object.keys(ART) };
