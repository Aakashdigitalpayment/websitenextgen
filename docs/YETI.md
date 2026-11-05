# Yeti Cloud (app.yetiapp.cloud) मा website host गर्ने

सहकारी वेबसाइट प्लेटफर्म (websitenextgen) लाई Yeti Cloud (Jelastic PaaS) मा **एउटै command** बाट चलाउने तरिका।
संरचना: एउटा Node.js (pm2) container मा code, छुट्टै PostgreSQL node, secrets server मै राखिने file मा (`/home/jelastic/coop.env`, mode 600)।

```
Browser ── HTTPS ──► Yeti shared load balancer (SSL) ──► Node.js container :8080
                                                           │  /home/jelastic/ROOT              git checkout (main)
                                                           │  /home/jelastic/coop-releases/     r-<मिति>-<commit>/ … current → चलिरहेको version
                                                           │  pm2: coop-web (8080) · coop-cleanup (हरेक दिन 02:30)
                                                           │  /home/jelastic/coop.env           secrets (कहिल्यै git मा होइन)
                                                           │  /home/jelastic/coop-data/uploads  फोटो/कागजात (release बाहिर)
                                                           ▼
                                                   PostgreSQL 16 node (database coop, role coop)
```

| File | काम |
|---|---|
| `ecosystem.config.js` | pm2 का app। Yeti को pm2 image ले container सुरु हुँदा यही file चलाउँछ |
| `deploy/yeti/install.sh` | **पहिलो पटक एक command**: database, env file, platform operator, पहिलो deploy, पहिलो सहकारी |
| `deploy/yeti/deploy.sh` | **हरेक release एक command**: नयाँ release folder, packages, DB copy, migration, switch, health check, असफल भए आफैँ पुरानोमा फर्किने |
| `deploy/yeti/bootstrap.sh` | खाली container: GitHub deploy key, clone, अनि `install.sh` |
| `deploy/yeti/remote.sh` | आफ्नै कम्प्युटरबाट: `npm run yeti -- setup / deploy / rollback / status / logs` |
| `.github/workflows/deploy-yeti.yml` | GitHub Actions मा एक click deploy (वा CI पास भएपछि आफैँ) |

---

## 1. Yeti dashboard मा environment (एक पटक)

**New Environment → Node.js**:

| ठाउँ | के छान्ने |
|---|---|
| Application server | **Node.js**, image tag **`…-pm2`**, version **22.x LTS** |
| Vertical scaling | Reserved **2–4** cloudlets, Scaling limit **8** (1 GiB); 8K फोटो धेरै upload हुने भए **16** |
| Node.js version | 22.x LTS सिफारिस; 24/26 पनि चल्छ (Node 20+ चाहिन्छ) |
| Disk limit | 20 GB+ (फोटो/कागजात यहीँ) |
| SSL | **ON** (Built-in: `https://<env>.ktm.yetiappcloud.com`) |
| SQL | **PostgreSQL 16**, Reserved 2, Scaling limit 8 |
| Environment name | जस्तै `coopweb` → `https://coopweb.ktm.yetiappcloud.com` |

Create पछि PostgreSQL को **webadmin** password email मा आउँछ। PostgreSQL node को नाम (`nodeNNNNN-coopweb.ktm.yetiappcloud.com`) टिप्नुहोस्: यही **DB host** हो।

**आफ्नो SSH key** (कम्प्युटरबाट चलाउने भए): dashboard → account (माथि दायाँ) → **Settings → SSH Keys → Add public key**।
SSH login dashboard मै देखिन्छ: Node.js node → **Web SSH ▾ → SSH** tab (`ssh 12345-67890@gate.… -p 3022`)।

## 2. पहिलो setup — Web SSH मा एउटै paste (DMS जस्तै)

Dashboard → environment (जस्तै **Aakashweb**) → **Application Servers** मा **Web SSH** खोल्ने।
तलको **पूरै block** copy गरेर Web SSH मा paste गर्ने र **Enter** थिच्ने:

```bash
{ K=~/.ssh/coopweb_deploy; mkdir -p ~/.ssh && chmod 700 ~/.ssh
[ -f $K ] || ssh-keygen -q -t ed25519 -C "yeti coopweb deploy" -f $K -N ""
grep -q '^Host github-coopweb$' ~/.ssh/config 2>/dev/null || printf 'Host github-coopweb\n  HostName ssh.github.com\n  Port 443\n  User git\n  IdentityFile %s\n  IdentitiesOnly yes\n' $K >> ~/.ssh/config
chmod 600 ~/.ssh/config $K
grep -q '^\[ssh.github.com\]:443 ssh-ed25519' ~/.ssh/known_hosts 2>/dev/null || echo '[ssh.github.com]:443 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' >> ~/.ssh/known_hosts
if ! ssh -o BatchMode=yes -T git@github-coopweb 2>&1 | grep -q successfully; then
  echo; echo "== यो key GitHub मा थप्नुहोस्: Aakashdigitalpayment/websitenextgen → Settings → Deploy keys → Add deploy key (Allow write access OFF) =="; echo; cat $K.pub; echo
  read -rp "Key थपेपछि Enter थिच्नुहोस्… " _
fi
cd /home/jelastic && if git -C ROOT remote get-url origin 2>/dev/null | grep -q websitenextgen; then git -C ROOT pull -q; else rm -rf ROOT.new && git clone -q git@github-coopweb:Aakashdigitalpayment/websitenextgen.git ROOT.new && { [ ! -d ROOT ] || mv ROOT "ROOT.sample.$(date +%s)"; } && mv ROOT.new ROOT; fi && git -C ROOT log -1 --oneline && read -rp "PostgreSQL node (dashboard → SQL node को नाम, जस्तै nodeNNNNN-aakashweb.ktm.yetiappcloud.com): " DBH && bash /home/jelastic/ROOT/deploy/yeti/install.sh --db-host "$DBH"; }
```

यसले क्रमैसँग:

1. **Deploy key** बनाएर देखाउँछ (`ssh-ed25519 …` लाइन)।
   - GitHub → `Aakashdigitalpayment/websitenextgen` → **Settings → Deploy keys → Add deploy key** मा जानुहोस्।
   - title: `Yeti server`; key: त्यो लाइन paste; **Allow write access OFF** → **Add key**।
   - Web SSH मा फर्केर **Enter** थिच्नुहोस्।
2. Code `/home/jelastic/ROOT` मा clone गर्छ (Yeti को नमुना app छेउ लगाएर)।
3. **PostgreSQL node** को नाम सोध्छ — dashboard मा SQL (हात्ती चिन्ह) node को नाम: `nodeNNNNN-aakashweb.ktm.yetiappcloud.com`।
4. "Other pm2 app(s) … remove them?" सोधे `y` (Yeti को नमुना app ले port 8080 ओगटेको हुन्छ)।
5. **webadmin password** — PostgreSQL बनाउँदा Yeti ले email मा पठाएको (टाइप गर्दा देखिँदैन)।
6. **Platform operator** को username र password (१२+ अक्षर) — `/platform` console को login।
7. पहिलो deploy (२–४ मिनेट): packages → migration → pm2 → `/healthz` जाँच।
8. "Create the first cooperative now?" → `y`: slug (जस्तै `aakash`), नाम नेपाली/English, design, plan, admin password।

### आफ्नै domain नभएसम्म (Yeti ठेगाना मात्र)

सबै एउटै ठेगानामा चल्छ:

| ठेगाना | के |
|---|---|
| `https://aakashweb.ktm.yetiappcloud.com` | पहिलो सहकारीको website |
| `https://aakashweb.ktm.yetiappcloud.com/admin` | सहकारीको admin (username `admin`) |
| `https://aakashweb.ktm.yetiappcloud.com/member/login` | सदस्य पोर्टल |
| `https://aakashweb.ktm.yetiappcloud.com/platform` | Platform console (operator) |

आफ्नै domain (जस्तै `coopcloud.com.np`) आएपछि थप सहकारीहरू `<slug>.coopcloud.com.np` मा: section 5।

> **पहिलो console login पछि:** console → 2FA खोल्ने, अनि `nano /home/jelastic/coop.env` बाट `PLATFORM_ADMIN_PASSWORD=` लाइन हटाउने।

बीचमा केही रोकियो भने **उही block फेरि paste** गर्नुहोस् — भइसकेका चरण छोडिन्छन्।

### कम्प्युटरबाट (वैकल्पिक)

Web SSH को सट्टा आफ्नै कम्प्युटर (Git Bash / Terminal) बाट पनि हुन्छ। Dashboard मा SSH key थपेपछि:

```bash
git clone https://github.com/Aakashdigitalpayment/websitenextgen.git && cd websitenextgen && YETI_SSH="<Web SSH ▾ → SSH मा देखिने login, जस्तै 12345-67890@gate.ktm.yetiappcloud.com -p 3022>" npm run yeti -- setup --db-host nodeNNNNN-aakashweb.ktm.yetiappcloud.com
```

**Non-interactive (CI/script)**: password हरू `COOP_DB_ADMIN_PASSWORD`, `PLATFORM_ADMIN_PASSWORD`, `ADMIN_PASSWORD` env मा, अनि `install.sh --yes --tenant-slug … --tenant-name … --design … --plan …`।

## 3. नयाँ version live गर्ने — एउटै शब्द

Setup पछि **नयाँ Web SSH tab** खोल्नुहोस्, अनि:

```bash
coop-deploy
```

यसले GitHub को `main` बाट code तान्छ → नयाँ release folder (पुरानो चलिरहन्छ) → `npm ci` → DB copy → migration → `current` सार्ने → pm2 reload → `/healthz`। **जाँच असफल भए अघिल्लो version आफैँ फर्किन्छ।**

| Web SSH command | काम |
|---|---|
| `coop-deploy` | नयाँ version live (`cd /home/jelastic/ROOT && bash deploy/yeti/deploy.sh`) |
| `coop-rollback` | अघिल्लो version मा (केही सेकेन्ड) |
| `coop-status` | pm2 status र health |
| `coop-logs` | पछिल्ला log |

कम्प्युटरबाट: `npm run yeti -- deploy | rollback | status | logs 200`।

## 4. GitHub बाट एक click (ऐच्छिक)

Repo → **Settings → Secrets and variables → Actions**:
- `YETI_SSH` = `12345-67890@gate.ktm.yetiappcloud.com -p 3022`
- `YETI_SSH_KEY` = private key (यसको public key Yeti → SSH Keys मा)
- `YETI_KNOWN_HOSTS` (ऐच्छिक) = `ssh-keyscan -p 3022 gate.ktm.yetiappcloud.com`

अनि **Actions → Deploy to Yeti → Run workflow** (deploy वा rollback)। हरेक `main` push मा tests पास भएपछि आफैँ deploy गर्न: repository variable `YETI_AUTO_DEPLOY` = `true`। Workflow `production` environment प्रयोग गर्छ, त्यसैले GitHub मा approval rule पनि राख्न सकिन्छ।

## 5. Domain र DNS

| के | कसरी |
|---|---|
| Platform domain (जस्तै `coopcloud.com.np`) | DNS: `*.coopcloud.com.np` र `admin.coopcloud.com.np` → **CNAME** `coopweb.ktm.yetiappcloud.com`। Dashboard → environment → **Custom domains → Bind** मा `*.coopcloud.com.np` र `admin.coopcloud.com.np` |
| Env file | `BASE_DOMAIN=coopcloud.com.np`, `PLATFORM_HOST=admin.coopcloud.com.np`, `CNAME_ZONE=coopcloud.com.np` (`--base-domain` ले आफैँ राख्छ) |
| सहकारीको आफ्नै domain (`www.mycoop.com.np`) | Admin → Website domain मा थपेपछि देखिने CNAME (`<slug>-xxxxx.coopcloud.com.np`) client को DNS मा। Yeti मा पनि **Bind** गर्नुपर्छ |
| HTTPS | `*.ktm.yetiappcloud.com` मा built-in SSL। आफ्नै domain का लागि dashboard → **Add-ons → Let's Encrypt Free SSL** (domain हरू comma ले)। Yeti मा यो add-on लाई **Public IPv4** चाहिन सक्छ — Yeti support/docs मा पक्का गर्नुहोस् |

DNS नमिल्दासम्म: `https://coopweb.ktm.yetiappcloud.com` (PLATFORM_HOST) बाट console चल्छ।

## 6. Backup

- हरेक deploy अघि `pg_dump` copy: `/home/jelastic/coop-backups/pre-deploy/` (पछिल्ला ३)।
- नियमित: PostgreSQL node मा Yeti को backup/snapshot, वा Admin → प्रणाली/ब्याकअप (प्रति सहकारी JSON)।
- `/home/jelastic/coop.env` को copy password manager मा — **PII_KEY र CREDENTIALS_KEY कहिल्यै नबदल्नुहोस्** (नागरिकता नम्बर र कार्यालय password पढ्ने एक मात्र उपाय)।
- फोटो/कागजात: `/home/jelastic/coop-data/uploads` (disk backup मा समावेश)।

## 7. पुरानो PHP site सार्ने

PHP site को folder र MySQL dump Yeti node मा ल्याएर (वा पहुँच भएको कम्प्युटरबाट `DATABASE_URL` राखेर):

```bash
cd /home/jelastic/coop-releases/current
node --env-file=/home/jelastic/coop.env scripts/migrate-site.js …     # विकल्पहरू: docs/DEPLOY.md §4
node --env-file=/home/jelastic/coop.env scripts/image-variants.js     # पुराना फोटोको 8K/4K/HD आकार
```

## 8. Troubleshooting

| लक्षण | उपाय |
|---|---|
| `pm2 not found` | Node.js image `…-pm2` होइन: dashboard मा image बदल्ने |
| Port 8080 busy / नमुना page देखिन्छ | `pm2 delete <app>` वा `install.sh --yes` |
| `/healthz` असफल, पुरानोमा फर्कियो | `npm run yeti -- logs 200` — प्रायः DB पहुँच वा env को कमी |
| "Site not found" पेज | Host मिलेन: `BASE_DOMAIN`/`PLATFORM_HOST` र DNS/Bind जाँच्ने; production मा `DEFAULT_TENANT` खाली राख्ने |
| Restart node पछि site बन्द | `pm2 status`; नभए `bash deploy/yeti/deploy.sh --rollback` (current फेरि दर्ता गर्छ) |

## 9. Server मा कहिल्यै नगर्ने

- `/home/jelastic/ROOT` का file हातले नसच्याउने (deploy ले `git reset --hard` गर्छ)।
- env file को मान screenshot/chat मा नपठाउने; repo मा `.env` commit नगर्ने।
- PostgreSQL node मा webadmin password reset नगर्ने (backup मा चाहिन्छ)।
