# Tau Gamma Phi — Digital Membership Registry

An official, NFC-based fraternity membership registry for **Tau Gamma Phi (ΤΓΦ)**.
Members carry an NFC card that resolves to a public verification page; the
fraternity administration governs membership, chapters, and digital IDs.

- **Public NFC verification** — tap a card → `/id/[slug]` → live, RLS-safe
  verification of name, member ID, chapter, photo, and standing.
- **Member portal** — register, manage your profile + photo, view your digital
  ID, NFC link, and QR code.
- **Admin console** — approve/reject members, assign chapters, change standing,
  manage roles, issue/regenerate NFC slugs, and review an audit log.

Built with **Next.js 16 (App Router)** · **TypeScript** · **Tailwind v4** ·
**shadcn-style UI** · **Supabase** (Auth + Postgres + Storage) with **Row Level
Security** throughout.

---

## 1. Prerequisites

- Node.js **20.9+**
- A free [Supabase](https://supabase.com) project

## 2. Database setup

1. Open your Supabase project → **SQL Editor**.
2. Paste and run the contents of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).

   This creates all tables, enums, the `avatars` storage bucket, every Row
   Level Security policy, the audit + ID-generation triggers, and the public
   `get_member_card()` verification RPC. It also seeds a few starter chapters.

## 3. Environment variables

Copy the example and fill in your project values:

```bash
cp .env.example .env.local
```

| Variable | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API → Publishable (anon) key |
| `NEXT_PUBLIC_SITE_URL` | _(optional)_ your public domain — used for NFC/QR links |

> The Supabase **service-role / secret key is never used** by this app. All
> privileged operations are authorised through RLS, so the secret key never
> reaches the browser or the server bundle.

## 4. Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

## 5. Create your first administrator

1. Register an account at `/register`.
2. In the Supabase **SQL Editor**, promote it (replace the email):

   ```sql
   update public.profiles
      set role = 'super_admin', status = 'active'
    where user_id = (select id from auth.users where email = 'you@example.com');
   ```

3. Sign in — the **Admin** tab now appears. From there you can approve members,
   which automatically issues their member ID (`TGP-0001…`) and NFC card.

## 6. Auth email links (optional)

If **email confirmation** is enabled in Supabase (Authentication → Providers →
Email), set the confirmation template / redirect to point at:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
```

and add your local + production origins under **Authentication → URL
Configuration → Redirect URLs**. For quick local testing you may disable
"Confirm email" so registrations sign in immediately.

---

## Deploying to Vercel

1. Push this repo to GitHub and **Import** it in Vercel.
2. Add the environment variables from step 3 in **Project → Settings →
   Environment Variables** (set `NEXT_PUBLIC_SITE_URL` to your Vercel domain).
3. Deploy. The default build command (`next build`) and output are detected
   automatically.
4. In Supabase, add your Vercel domain to **Authentication → URL Configuration
   → Redirect URLs**.

Program your physical NFC cards to write the URL
`https://<your-domain>/id/<slug>` — the slug for each member is shown in their
portal and in the admin member view (with a copy button and QR code).

---

## Security model

- **RLS on every table.** Members read/edit only their own profile; admins are
  gated by `SECURITY DEFINER` helper functions (`is_admin`, `is_super_admin`)
  that avoid policy recursion.
- **Privileged columns are trigger-protected.** A `BEFORE UPDATE` trigger resets
  `role`, `status`, `member_id`, and `chapter_id` for any non-admin caller —
  even a forged request cannot self-promote.
- **The public sees only a whitelist.** Anonymous visitors never touch the
  tables; the verification page calls the `get_member_card()` RPC, which returns
  exactly the fields shown on the card and records the scan.
- **Audit logging is automatic.** Status, role, and chapter changes are written
  to `audit_logs` by `SECURITY DEFINER` triggers (no client-side trust).

## Project structure

```
app/
  (auth)/            login · register                (public)
  auth/confirm/      email OTP route handler
  id/[slug]/         public NFC verification page     (public)
  (app)/             authenticated shell
    dashboard/       member portal + digital ID + NFC/QR
    profile/         edit profile + photo upload
    admin/           members · members/[id] · chapters · audit  (RBAC)
  forbidden.tsx · unauthorized.tsx · error.tsx · not-found.tsx
components/          ui primitives, brand (seal/wordmark), id-card, admin, auth
lib/
  supabase/          browser · server · proxy clients
  actions/           auth · profile · admin server actions
  auth.ts            request-cached DAL (getAuth/requireUser/requireAdmin)
  types.ts           database + domain types
proxy.ts             session refresh + optimistic route gate (Next.js 16)
supabase/migrations/ 0001_init.sql  (schema · RLS · triggers · storage)
```

This is **Next.js 16** — middleware is `proxy.ts`, `params`/`cookies()` are
async, and role interrupts use `forbidden()`/`unauthorized()`
(`experimental.authInterrupts`).
