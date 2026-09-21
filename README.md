# Talisay Stake — Know Your Specialist

A directory app for the Talisay Stake Welfare & Self-Reliance (WSR) organization.
Visitors pick a ward from a dropdown and see everyone's name, photo, and Messenger
contact, laid out as a connected org chart. An admin account (no public sign-up)
can edit names, upload photos, and set Messenger/phone/email info for anyone,
live, from the browser.

Built with Next.js (App Router), TypeScript, Tailwind CSS, and shadcn/ui.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:3001. On first admin login attempt, a random admin
password is printed once in the terminal — copy it before it scrolls away. Log
in at `/admin/login` and use **Change password** to set your own.

## Data

Everyone's info lives in `data/directory.json`, edited entirely through the
admin UI. Uploaded photos are saved to `public/uploads/`.

This app writes real data at runtime (directory edits, uploaded photos, the
admin password), and it stores that data one of two ways, chosen
automatically:

- **`BLOB_READ_WRITE_TOKEN` is set** (always true on Vercel once a Blob store
  is connected) → data lives in [Vercel Blob](https://vercel.com/docs/vercel-blob)
  storage, which survives redeploys on any host, serverless included.
- **Not set** (plain `npm run dev`, or a host like Render with no Blob store
  connected) → data is written straight to local disk (`data/`,
  `public/uploads/`), the same as this app always did.

That means the same codebase deploys to either platform below with no code
changes — just different environment variables.

## Deploying so the whole stake can use it

### Option A: Vercel (data survives redeploys automatically)

Vercel's serverless functions can't write to local disk — anything saved
there disappears the moment the request ends — so this path relies on the
Blob store for persistence. Once it's connected, edits, uploads, and the
admin password all persist across redeploys with no manual backup step.

1. **Push this repo to GitHub.** Create a new **empty** repository at
   [github.com/new](https://github.com/new) (no README/license — this
   project already has one), then:

   ```bash
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```

2. **Create the Vercel project.** Go to [vercel.com](https://vercel.com),
   sign up (free, no card required), **Add New** → **Project** → import the
   GitHub repo. Framework preset auto-detects as Next.js. Under
   **Environment Variables**, add:
   - `ADMIN_USER` — the admin username you want (e.g. `admin`)
   - `ADMIN_PASS` — a real password you choose (this becomes the permanent
     login; you won't see it printed anywhere)

   **Deploy.** First deploy takes a minute or two.

3. **Connect a Blob store.** In the project dashboard: **Storage** →
   **Create Database** → **Blob** → connect it to this project. Vercel
   automatically adds a `BLOB_READ_WRITE_TOKEN` environment variable, then
   redeploy once (**Deployments** → ⋯ → **Redeploy**) so it takes effect.

Vercel gives you a URL like `https://talisay-wsr-next.vercel.app`.

**Running it locally against the same Blob store:**

```bash
npx vercel link      # first time only, links this folder to the Vercel project
npx vercel env pull .env.local
npm run dev
```

**Updating later:** commit, `git push`, Vercel redeploys automatically.
Directory data, photos, and the admin login live in the Blob store, not the
deploy artifact, so nothing resets.

### Option B: Render (free, one caveat)

Render keeps a persistent Node.js server running, so it can use the local-disk
path directly — no Blob store needed. The one caveat: **redeploying resets
the disk** back to whatever was last committed to GitHub, wiping any photos
or edits made through the admin UI since then. Two things guard against that:

- **Download backup** in the admin dashboard exports the current data as a
  JSON file at any time — do this occasionally, and definitely right before
  pushing a code update.
- The admin login itself won't reset, because you set it via environment
  variables (below), not the auto-generated one that lives on disk.

1. **Push this repo to GitHub** (same steps as above, if not done already).
2. Go to [render.com](https://render.com) and sign up (free, no card
   required). **New +** → **Web Service** → connect the GitHub repo.
3. Settings:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Under **Environment**, add:
   - `ADMIN_USER` — the admin username you want
   - `ADMIN_PASS` — a real password you choose (immune to disk resets)
5. **Create Web Service.** First deploy takes a few minutes.

Render gives you a URL like `https://talisay-wsr-next.onrender.com`. The free
tier sleeps after 15 minutes of inactivity, so the first visit after a quiet
stretch takes ~30–60 seconds to wake up.

**Updating later:** commit, `git push`, Render redeploys automatically.
**Download a backup first** if there have been edits since the last one — the
redeploy resets the disk to match GitHub.

### Running both at once

Nothing stops you from deploying to both — they're independent, each with
its own data (Render on local disk, Vercel on Blob). If you'd rather they
share one dataset, set `BLOB_READ_WRITE_TOKEN` (and the other Blob-related
vars `vercel env pull` gives you) on Render too — Vercel Blob is just an
HTTPS API, not tied to running on Vercel's infrastructure — and Render will
use it exactly like Vercel does.
