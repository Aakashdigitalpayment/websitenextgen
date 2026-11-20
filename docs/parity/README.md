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
