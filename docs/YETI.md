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
| Disk limit | 20 GB+ (फोटो/कागजात यहीँ) |
| SSL | **ON** (Built-in: `https://<env>.ktm.yetiappcloud.com`) |
| SQL | **PostgreSQL 16**, Reserved 2, Scaling limit 8 |
| Environment name | जस्तै `coopweb` → `https://coopweb.ktm.yetiappcloud.com` |

Create पछि PostgreSQL को **webadmin** password email मा आउँछ। PostgreSQL node को नाम (`nodeNNNNN-coopweb.ktm.yetiappcloud.com`) टिप्नुहोस्: यही **DB host** हो।

**आफ्नो SSH key** (कम्प्युटरबाट चलाउने भए): dashboard → account (माथि दायाँ) → **Settings → SSH Keys → Add public key**।
SSH login dashboard मै देखिन्छ: Node.js node → **Web SSH ▾ → SSH** tab (`ssh 12345-67890@gate.… -p 3022`)।

## 2. पहिलो setup — एउटै command

### क) आफ्नो कम्प्युटरबाट (सिफारिस)

```bash
cp deploy/yeti/remote.env.example deploy/yeti/remote.env    # YETI_SSH="12345-67890@gate.ktm.yetiappcloud.com -p 3022" राख्ने
npm run yeti -- setup --db-host nodeNNNNN-coopweb.ktm.yetiappcloud.com --base-domain coopcloud.com.np
```

यसले server मा:
1. read-only **deploy key** बनाउँछ र देखाउँछ → GitHub → repo → **Settings → Deploy keys → Add deploy key** (write access OFF) → Enter।
   (`GITHUB_TOKEN` राखे — यो repo मात्र, "Administration: write" भएको token — key आफैँ थपिन्छ।)
2. repo लाई `/home/jelastic/ROOT` मा clone गर्छ (Yeti को नमुना app छेउ लगाएर)।
3. **webadmin password** सोध्छ (देखिँदैन) → role/database `coop` र `/home/jelastic/coop.env` (SESSION_SECRET, PII_KEY, CREDENTIALS_KEY आफैँ बन्छन्)।
4. **Platform operator** को username/password सोध्छ (console: `https://<PLATFORM_HOST>/platform`)।
5. पहिलो deploy (2–4 मिनेट): packages → migration → pm2 → `/healthz` जाँच।
6. "पहिलो सहकारी बनाउने?" — slug, नाम, design (saving_credit / multipurpose / agriculture / women / microfinance), plan (lite / basic / advance / extra), admin password। पछि console बाट पनि बनाउन सकिन्छ।

### ख) Yeti Web SSH भित्रबाटै

Node.js node → **Web SSH**। पहिले `deploy/yeti/bootstrap.sh` को सामग्री paste गरी (वा deploy key/clone आफैँ गरेर) अनि:

```bash
cd /home/jelastic/ROOT && bash deploy/yeti/install.sh --db-host nodeNNNNN-coopweb.ktm.yetiappcloud.com --base-domain coopcloud.com.np
```

फेरि चलाउँदा केही बिग्रँदैन: भइसकेका चरण छोडिन्छन्।

**Non-interactive (CI/script)**: password हरू `COOP_DB_ADMIN_PASSWORD`, `PLATFORM_ADMIN_PASSWORD`, `ADMIN_PASSWORD` env मा, अनि `--yes --tenant-slug … --tenant-name … --design … --plan …`।

## 3. नयाँ version live गर्ने — एउटै command

```bash
npm run yeti -- deploy          # कम्प्युटरबाट
bash deploy/yeti/deploy.sh      # वा Web SSH मा, /home/jelastic/ROOT बाट
```

Script ले: एक पटकमा एउटा deploy (lock) → `origin/main` → नयाँ release folder (पुरानो चलिरहन्छ) → `npm ci` → **pg_dump copy** (पछिल्ला ३) → migration → `current` सार्ने → pm2 reload → `/healthz`। **Health check असफल भए अघिल्लो release आफैँ फर्किन्छ।** पछिल्ला ३ release राखिन्छन्।

| Command | काम |
|---|---|
| `npm run yeti -- rollback` | अघिल्लो release मा (केही सेकेन्ड; migration उल्टाइँदैन — सधैँ additive) |
| `npm run yeti -- status` | pm2 status, health, live commit |
| `npm run yeti -- logs 200` | पछिल्ला 200 log लाइन |
| `npm run yeti -- ssh` | node मा shell |

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
