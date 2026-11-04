'use strict';
/**
 * Per-tenant public site layout: where the menu sits, how the home page opens, corner style.
 * Pure presentation (CSS classes on <body>), so every tenant can look different without forking templates.
 */
const HEADERS = [
  { key: 'classic', np: 'क्लासिक', en: 'Classic', hint: ['लोगो बायाँ, मेनु दायाँ', 'Logo left, menu right'] },
  { key: 'centered', np: 'बीचमा', en: 'Centred', hint: ['लोगो बीचमा, मेनु तल', 'Logo centred, menu below'] },
  { key: 'bar', np: 'रङ्गीन मेनु पट्टी', en: 'Menu bar', hint: ['लोगो माथि, रङ्गीन मेनु पट्टी तल', 'Logo row with a coloured menu bar'] },
  { key: 'minimal', np: 'न्यूनतम', en: 'Minimal', hint: ['मेनु बटनभित्र (☰)', 'Menu behind a button (☰)'] },
];
const HOMES = [
  { key: 'split', np: 'दुई भाग', en: 'Split', hint: ['बायाँ पाठ, दायाँ स्लाइड', 'Text left, slides right'] },
  { key: 'banner', np: 'पूरा ब्यानर', en: 'Full banner', hint: ['पूरा चौडाइको स्लाइडमाथि पाठ', 'Text over a full-width slide'] },
  { key: 'centered', np: 'बीचमा', en: 'Centred', hint: ['बीचमा शीर्षक, तल स्लाइड', 'Centred heading, slides below'] },
];
const CORNERS = [
  { key: 'rounded', np: 'गोलो', en: 'Rounded' },
  { key: 'soft', np: 'हल्का गोलो', en: 'Soft' },
  { key: 'square', np: 'सिधा', en: 'Square' },
];
const LANGS = [
  { key: 'both', np: 'नेपाली र English', en: 'Nepali & English' },
  { key: 'np', np: 'नेपाली मात्र', en: 'Nepali only' },
  { key: 'en', np: 'English मात्र', en: 'English only' },
];
const valid = (list, v, d) => (list.some(x => x.key === v) ? v : d);

function resolve(s = {}) {
  const header = valid(HEADERS, s.layout_header, 'classic');
  const home = valid(HOMES, s.layout_home, 'split');
  const corners = valid(CORNERS, s.layout_corners, 'rounded');
  return { header, home, corners, bodyClass: `hdr-${header} home-${home} corners-${corners}` };
}

module.exports = { HEADERS, HOMES, CORNERS, LANGS, resolve, valid };
