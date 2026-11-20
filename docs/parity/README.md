# PHP → Node parity audit

Gap reports comparing the old PHP/MySQL site (`Aakashdigitalpayment/websourcecode`) with this Node rewrite.
Each report lists features as DONE / PARTIAL / MISSING with an implementation spec (PHP file + line refs,
tables, Node files to change) and a priority (P1 users notice, P2, P3).

| Report | Scope | Migration |
|---|---|---|
| [1-public.md](1-public.md) | Public website pages (home, about, news, reports, calendar, SEO, PWA, AI chat) | 061 |
| [2-forms-member.md](2-forms-member.md) | Online forms, tracker, card verify, member portal and login | 062 |
| [3-admin-system.md](3-admin-system.md) | Admin auth/2FA, settings, CMS content CRUD, audit, licence | 063 |
| [4-admin-ops.md](4-admin-ops.md) | Application inboxes, members, programmes, elections, welfare, auctions | 060 |
| [coverage.md](coverage.md) | File-by-file / function-by-function matrix of the whole PHP site | — |

## Deliberately not ported (CLAUDE.md §1)

| PHP | Why it is not in Node |
|---|---|
| HRM (`admin/hrm-*.php`) | Removed on purpose (`db/migrations/005_remove_hrm.sql`); not part of the cooperative website product. |
| Temporary plain-text passwords sent by SMS/email | Insecure; Node uses OTP reset and office-set passwords with forced change. |
| `sw.js` member-page cache (`PAGES_CACHE`) and `member/offline.php` cached dashboard (name, unread count) | Privacy on shared phones: the service worker never caches member or admin HTML; `/offline` is a generic page. |
| `api-public-chat.php` live-chat panel | Folded into the contact form (`POST /contact`) and the AI assistant; no staff chat console exists in Node. |
| `assets/js/scroll-accessibility.js`, `assets/js/pull-to-refresh.js` | Browser-native scrolling and pull-to-refresh do the same job; the custom scripts fought with the native behaviour. |
| `?embed=1` iframe modes (`digital-services.php`, `member/apply-frame.php`) | The portal links straight to the forms; framing is blocked by `frame-ancestors 'self'`. |
| `core/helpers.php` finance helpers | Dead code in PHP (no caller). |
| Rashifal / lagna / gunmilan tabs of `sahakari-patro.php` | Astrology content outside the cooperative's remit; the BS calendar, holidays and events are ported. |
| PHP default VAPID key pair in `includes/push-vapid-config.php` | That private key is public in the PHP repository; only a site's own `push-vapid.local.php` pair is imported. |
| Platform operator TOTP replay guard in the database | The operator console keeps its in-process guard; tenant admins and members use `twofa_last_step` (SM-21). |

