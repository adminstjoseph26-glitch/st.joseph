# St Joseph's College: Cloudflare Workers + D1 + R2

| Sehemu | Kinafanya nini |
|---|---|
| **Workers** (`src/index.js`) | API yote (`/api/*`): kuingia, usajili, wanafunzi, matokeo, vitabu, mikopo, E-Library |
| **D1** (`migrations/0001_init.sql`) | Jedwali zote: students, users, sessions, grades, books, loans, ebooks, messages, subscribers |
| **R2** (bucket `sjc-ebooks`) | Faili halisi za E-Library (PDF, EPUB, DOC, DOCX, TXT hadi 20 MB) |
| **Static assets** (`public/index.html`) | Tovuti yenyewe, inatolewa na Cloudflare moja kwa moja |

## Kupeleka mtandaoni (mara ya kwanza)

```bash
npm install
npx wrangler login

# 1. Tengeneza database, kisha nakili "database_id" iliyoonyeshwa kwenye wrangler.jsonc
npx wrangler d1 create sjc-db

# 2. Tengeneza bucket ya R2 (lazima R2 iwe imewashwa kwenye dashboard ya Cloudflare)
npx wrangler r2 bucket create sjc-ebooks

# 3. Tengeneza majedwali
npx wrangler d1 migrations apply sjc-db --remote

# 4. Tengeneza akaunti ya admin (nenosiri linahifadhiwa likiwa hashed)
node scripts/make-admin.mjs
npx wrangler d1 execute sjc-db --remote --file=admin.sql
rm admin.sql

# 5. Weka mtandaoni
npx wrangler deploy
```

Mwisho utapata anwani kama `https://sjc-college.<akaunti-yako>.workers.dev`.
Domain yako mwenyewe: Cloudflare Dashboard → Workers → sjc-college → Settings → Domains & Routes.

## Kujaribu kwenye kompyuta (bila kugusa mtandao)

```bash
npm install
npm run db:local
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='nenosiri-refu-12+' node scripts/make-admin.mjs
npx wrangler d1 execute sjc-db --local --file=admin.sql && rm admin.sql
npx wrangler dev        # http://localhost:8787
```

## Mabadiliko kutoka toleo la zamani

- Data hazihifadhiwi tena kwenye `localStorage`; kila mtu anaona data zilezile kutoka D1.
- Faili za E-Library zinaenda R2 (si tena base64 ndani ya JSON, na kikomo kimepanda kutoka 1.5 MB hadi 20 MB).
- Akaunti za demo na data za mfano zimeondolewa. Mfumo unaanza mtupu; admin wa kwanza unamtengeneza wewe.
- Nenosiri linathibitishwa kwenye seva (PBKDF2-SHA256, salt ya kila mtumiaji). Kikao ni cookie ya `HttpOnly`, siku 7.
- Kila njia ya admin inakaguliwa kwenye seva; mwanafunzi anapokea data zake pekee (wasifu, matokeo, mikopo).
- Kitufe cha "Reset to demo data" kimeondolewa.

## Usalama na matengenezo

- **Kuingia**: baada ya majaribio 5 mabaya kwa barua pepe moja, kuingia kunafungwa dakika 15.
- **Spam**: fomu za usajili/mawasiliano ziko wazi kwa umma. Washa *Security → WAF → Rate limiting rules* kwa `/api/register`, `/api/contact`, `/api/subscribe`; ukipenda ongeza Cloudflare Turnstile.
- **Backup ya D1**: `npx wrangler d1 export sjc-db --remote --output=backup.sql` (D1 pia ina Time Travel ya siku 30).
- **Backup ya R2**: faili zinakaa R2; tumia `rclone` au Cloudflare Dashboard kuzinakili ukihitaji.
- Wanafunzi wanaoongezwa na admin (Add student) hawapati akaunti ya kuingia; wanaojisajili wenyewe mtandaoni wanapata.
