# DLI HR Assistant — Cloudflare Edition

The same HR leave management chat bot + admin dashboard, rebuilt to run on
**Cloudflare** (Worker + static assets + D1 database) and deploy from **GitHub**.
Once deployed you get a real public URL — `https://dli-hr-assistant.<your-subdomain>.workers.dev`
(or your own domain) — that any employee can open from a browser, on any device,
without you running anything locally.

> Looking for the plain Node.js version instead (runs on any server with `node
> server/index.js`, uses SQLite + Python/openpyxl)? That's a separate delivery —
> this one is purpose-built for Cloudflare.

## What changed vs. the Node.js version

Cloudflare's platform doesn't run a persistent Node process or give you a local
SQLite file, so the backend was rebuilt for that environment while keeping every
feature, API route, and the entire frontend UI identical:

| | Node.js version | Cloudflare version |
|---|---|---|
| Server runtime | Node.js `http` module | Cloudflare Worker (`src/index.ts`) |
| Database | SQLite file (`node:sqlite`) | **D1** — Cloudflare's managed SQLite-compatible database |
| Password hashing | Node `crypto.scrypt` | Web Crypto `PBKDF2` (native to Workers) |
| Excel import/export | Python + `openpyxl` (subprocess) | `xlsx` (SheetJS), pure JS, bundled into the Worker |
| Frontend | Same `public/index.html`, `admin.html`, `style.css` | **Unchanged** — copied over as-is |

Every API endpoint (`/api/branding`, `/api/employee/apply`, `/api/admin/...`, etc.)
has the exact same path and behavior in both versions, so the frontend needed zero
code changes.

## Project structure

```
dli-hr-cloudflare/
├── wrangler.toml         # Cloudflare config: Worker entry, D1 binding, static assets
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts            # Single Worker entrypoint — routes /api/* and serves static files
│   └── lib/
│       ├── db.ts              # D1 query helpers + row → API-response mapping
│       ├── auth.ts             # Password hashing (Web Crypto PBKDF2) + session tokens
│       ├── leave.ts             # Business-day leave calculation
│       └── xlsx-helper.ts        # Excel import/export via SheetJS
├── migrations/
│   ├── 0001_init.sql        # D1 schema (employees, leave_requests, settings, admin_sessions)
│   └── 0002_seed.sql         # Default admin password + branding + 5 demo DLI employees
└── public/
    ├── index.html            # Employee chat bot UI
    ├── admin.html              # Admin dashboard UI
    └── style.css                # Shared styling
```

## Before you deploy — an honest note on testing

This project was built and reviewed carefully (the full TypeScript source
type-checks cleanly, the D1 migrations were validated against a real SQLite
engine, and the password-hashing algorithm was verified byte-for-byte against the
seeded default password), but it was **not** run end-to-end against the actual
`wrangler dev` / Cloudflare Workers runtime, because that tooling needs an `npm
install` and live Cloudflare account access that aren't available in the
environment this was built in. Please do a local `wrangler dev` smoke test (Step 4
below) before pointing employees at the live URL — it only takes a few minutes and
will catch anything environment-specific.

## Requirements

- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A free [GitHub account](https://github.com) and [Git](https://git-scm.com/) installed
- [Node.js](https://nodejs.org) 18+ and npm installed on your computer (only needed
  to run `wrangler` commands — Cloudflare runs the actual app, not your machine)

## Step-by-step deployment

### 1. Push this project to GitHub

```bash
cd dli-hr-cloudflare
git init
git add .
git commit -m "Initial commit — DLI HR Assistant"
```

Create a new empty repository on GitHub (github.com → New repository — don't
initialize it with a README), then:

```bash
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git branch -M main
git push -u origin main
```

### 2. Install Wrangler and log in

Wrangler is Cloudflare's CLI — you'll use it to create the database and deploy.

```bash
npm install
npx wrangler login
```

This opens a browser window to authorize Wrangler against your Cloudflare account.

### 3. Create the D1 database

```bash
npx wrangler d1 create dli-hr-db
```

This prints a block like:

```toml
[[d1_databases]]
binding = "DB"
database_name = "dli-hr-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy the `database_id` value and paste it into `wrangler.toml` in this project,
replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

Then run the migrations to create the tables and seed demo data:

```bash
npm run db:migrate:remote
```

(Type `y` if it asks to confirm applying migrations to the remote/production
database — that's expected, D1 doesn't have a separate "production" toggle to
worry about at this stage.)

### 4. Test locally before going live

```bash
npm run dev
```

This starts Wrangler's local dev server (typically `http://localhost:8787`) running
against a **local** copy of your D1 database (migrations applied automatically to
it the first time). Open it in a browser and check:

- The chat bot loads at `/` and you can look up a demo employee (try `DLI001`)
- You can apply for leave and see it appear as Pending
- `/admin.html` logs in with the default password `DLI@Admin123`
- The admin dashboard shows the pending request and you can approve/reject it
- Excel download (Import/Export tab → Download as Excel) produces a working `.xlsx`
- Uploading that same file back in works and updates employees

If anything doesn't work, this is the point to fix it — much easier locally than
after employees have the live link.

### 5. Deploy to Cloudflare

```bash
npm run deploy
```

Wrangler builds the Worker (bundling `src/index.ts` and the `xlsx` package),
uploads the `public/` folder as static assets, and gives you a live URL:

```
https://dli-hr-assistant.<your-subdomain>.workers.dev
```

That's the link to share:

- **Employees** use the URL directly — that's the chat bot.
- **Admins** go to `https://dli-hr-assistant.<your-subdomain>.workers.dev/admin.html`.

### 6. Change the default admin password immediately

Log into the admin dashboard with `DLI@Admin123` and go to Settings → Change Admin
Password **right away**. The app is now reachable by anyone with the link, not just
people on your machine — don't skip this.

### 7. (Optional) Use your own domain

If DLI owns a domain and you'd like `hr.dli.com` (for example) instead of the
`workers.dev` address:

1. Add the domain to your Cloudflare account (Cloudflare dashboard → Add a Site) if
   it isn't already there, and point its nameservers at Cloudflare as instructed.
2. In the Cloudflare dashboard, go to **Workers & Pages** → your `dli-hr-assistant`
   Worker → **Settings** → **Domains & Routes** → **Add** → **Custom Domain**, and
   enter the subdomain you want (e.g. `hr.dli.com`).
3. Cloudflare provisions the SSL certificate and routes that domain to your Worker
   automatically — usually within a minute or two.

## Making future changes

Because this deploys from GitHub, the normal workflow is:

```bash
# edit files (e.g. public/index.html, src/index.ts, migrations/...)
git add .
git commit -m "Describe the change"
git push
npm run deploy
```

`npm run deploy` re-bundles and re-uploads the Worker and static assets. If you
change the database schema, add a new migration file (e.g.
`migrations/0003_your_change.sql`) rather than editing `0001_init.sql`, then run
`npm run db:migrate:remote` again — D1 tracks which migrations have already been
applied and only runs new ones.

> Want push-to-deploy (no manual `npm run deploy` step)? In the Cloudflare
> dashboard, go to **Workers & Pages** → your Worker → **Settings** → **Builds** and
> connect it to your GitHub repository. Cloudflare will then build and deploy
> automatically on every push to `main`.

## Data model (unchanged from the Node.js version)

- **Employees**: Employee ID, Name, Email, Department, Designation, Join Date, and
  four leave balances — Annual, Sick, Casual (numeric day balances that decrease on
  approval), and Unpaid (tracks days taken, no cap).
- **Leave Requests**: linked to an employee, with type, date range, computed
  business days (Friday/Saturday treated as the weekend — adjust `isWeekend` in
  `src/lib/leave.ts` if your organization uses a different weekend), reason, status
  (Pending/Approved/Rejected), and timestamps. Balance is only deducted once an
  admin approves a request.

## Admin dashboard features (unchanged)

Search/add/edit/delete employees, view any employee's full leave history, approve
or reject pending leave requests, download all employees as a formatted `.xlsx`,
bulk-upload an `.xlsx` to add/update employees (recognizes common header spellings —
use **Download as Excel** first to get a template with the exact columns), and edit
the app's name/company name/icon live from Settings.

## Costs

Cloudflare's free plan covers this comfortably for a normal company HR portal:
Workers free tier includes 100,000 requests/day, and D1's free tier includes 5GB of
storage and 25 billion row reads/month. You will not need a paid plan unless DLI is
an unusually large organization.

## Security checklist before sharing the link company-wide

- Change the default admin password immediately after first deploy (Step 6).
- HTTPS is automatic on both the `workers.dev` URL and any custom domain added
  through Cloudflare — nothing extra to configure.
- D1 backs up automatically, but you can also run
  `npx wrangler d1 export dli-hr-db --remote --output backup.sql` periodically for
  your own copy.
- If the portal should only be reachable from inside DLI's network rather than the
  public internet, Cloudflare Access (in the Zero Trust dashboard) can put a login
  wall in front of the whole Worker — ask if you'd like help setting that up.
