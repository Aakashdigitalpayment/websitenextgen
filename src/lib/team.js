'use strict';
/** Team page: staff groups, navbar menu categories and org-chart rows (ported from team-chart-helpers.php / team-menu-categories.php). */
const db = require('../db');

/** 0 = auto from flags / title, 1–5 = manual row on the public chart. */
function chartRow(m) {
  const stored = Number(m.chart_row) || 0;
  if (stored >= 1 && stored <= 5) return stored;
  if (Number(m.is_chairman) || Number(m.is_ceo)) return 1;
  const pos = [m.position, m.position_np, m.position_en].filter(Boolean).join(' ').toLowerCase();
  if (/chair(man|person)?|अध्यक्ष|ceo|chief\s*executive|कार्यकारी\s*अधिकृत|प्रमुख\s*कार्यकारी/i.test(pos) && !/vice[\s-]*chair|उप[\s-]*अध्यक्ष|उपाध्यक्ष/i.test(pos)) return 1;
  if (/vice[\s-]*chair|उप[\s-]*अध्यक्ष|उपाध्यक्ष/i.test(pos)) return 2;
  if (/director|manager|सञ्चालक|निर्देशक|प्रबन्धक/i.test(pos)) return 2;
  if (/member|सदस्य|secretary|सचिव|treasurer|कोषाध्यक्ष|representative/i.test(pos)) return 3;
  return 4;
}

/** [[row, [members]], …] sorted by row, then display order, then name. */
function chartRows(members) {
  const rows = new Map();
  for (const m of members) { const r = chartRow(m); if (!rows.has(r)) rows.set(r, []); rows.get(r).push(m); }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([r, list]) => [r, list.sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0) || String(a.name).localeCompare(String(b.name)))]);
}

const usesChart = (members, slug) => ['top_management', 'management', 'board'].includes(slug) || members.some(m => Number(m.chart_row) >= 1);

/** Board-alias committees ("सञ्चालक समिति" / "Board of directors") are the fixed board category. */
function isBoardAlias(ct) {
  const en = String(ct.name || '').trim().toLowerCase();
  const np = String(ct.name_np || '').replace(/\s+/g, ' ').trim();
  return /सञ्चालक समिति|संचालक समिति/.test(np) || ['board', 'board of directors', 'board committee'].includes(en) || en.includes('board of director');
}

async function load() {
  const [people, groups, cats, committees] = await Promise.all([
    db.many('SELECT * FROM team_members WHERE is_active = 1 ORDER BY display_order, id'),
    db.many('SELECT * FROM team_staff_groups WHERE is_active = 1 ORDER BY display_order, id'),
    db.many('SELECT * FROM team_menu_categories WHERE is_active = 1 ORDER BY display_order, id'),
    db.many('SELECT * FROM committee_types WHERE is_active = 1 ORDER BY display_order, id'),
  ]);
  return { people, groups, cats, committees };
}

/**
 * Sections for the public /team page. menuSlug narrows to one navbar category (like team.php?menu=…).
 * Section: { id, label:[np,en], members, chart: [[row, members]] | null, link? }
 */
function sections(data, menuSlug) {
  const { people, groups, cats, committees } = data;
  const cat = menuSlug ? cats.find(c => c.slug === menuSlug) : null;
  const staffFallback = cats.find(c => c.source_type === 'staff');
  const cmtFallback = cats.find(c => c.source_type === 'committees');
  const inCat = (menuId, fallback) => !cat || Number(menuId) === cat.id || (!menuId && fallback && fallback.id === cat.id);
  const out = [];
  const add = (id, label, members, slug, extra = {}) => {
    if (!members.length && !extra.link) return;
    out.push({ id, label, members, chart: members.length && usesChart(members, slug) ? chartRows(members) : null, ...extra });
  };
  const by = key => people.filter(p => p.category === key);
  const showStaff = !cat || cat.source_type === 'staff';
  const showCommittees = !cat || cat.source_type === 'committees';
  if (showCommittees && (!cat || Number(cat.include_board) || committees.some(c => isBoardAlias(c) && inCat(c.menu_category_id, cmtFallback)))) {
    const alias = committees.find(isBoardAlias);
    add('board', alias ? [alias.name_np || alias.name, alias.name || alias.name_np] : ['सञ्चालक समिति', 'Board of directors'], by('board'), 'board');
  }
  if (showStaff) {
    if (inCat(null, staffFallback)) {
      add('management', ['व्यवस्थापन', 'Management'], by('management'), 'management');
      add('staff', ['कर्मचारी', 'Staff'], by('staff'), 'staff');
    }
    for (const g of groups) {
      if (['board', 'management', 'staff'].includes(g.slug) || (cat && !inCat(g.menu_category_id, staffFallback))) continue;
      add(g.slug, [g.name_np || g.name_en, g.name_en || g.name_np], by(g.slug), g.slug);
    }
  }
  if (showCommittees) {
    for (const c of committees) {
      if (isBoardAlias(c) || (cat && !inCat(c.menu_category_id, cmtFallback))) continue;
      add('cmt-' + c.id, [c.name_np || c.name, c.name || c.name_np], by('cmt_' + c.id), '', { link: '/committees/' + c.id });
    }
  }
  const officers = (!cat || (cat.source_type === 'staff' && Number(cat.include_contact_officers))) ? people.filter(p => Number(p.is_information_officer) || Number(p.is_grievance_officer)) : [];
  return { cat, sections: out, officers };
}

/** Navbar: active categories shown in the menu (for navigation.js). */
async function navCategories() {
  return db.many('SELECT slug, name_np, name_en FROM team_menu_categories WHERE is_active = 1 AND show_in_nav = 1 ORDER BY display_order, id LIMIT 20');
}

module.exports = { chartRow, chartRows, usesChart, isBoardAlias, load, sections, navCategories };
