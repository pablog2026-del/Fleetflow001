# Northgate Fleet Systems — Stage one

Expo (iOS / Android / web PWA) + Supabase app for **Admin + Fleet owner** (build spec §3 and the §12 stage-one additions). The owner screens follow the owner simulator.

## What's in stage one

| Spec | Where |
|---|---|
| **Door 1 — Admin-created customer**: create the company, add trucks by VIN (NHTSA decode), draft OEM schedules, **Admin confirms each interval**, then invite the owner | `new-customer`, `customer/[id]`, `add-truck`, `review/[fleet]`, `interval/[id]`, Edge Function `invite-owner` |
| **Door 2 — Self-signup**: owner signs up into an empty account, adds company + trucks; **pending/trial** until Admin approves; intervals stay drafts until confirmed | `auth/sign-up`, `onboarding`, RPC `self_signup_create_fleet`, `admin_set_org_status` |
| **Admin**: sees every org; approvals; operations (open work, awaiting approval, overdue, trucks down); every invoice; platform fee revenue; fee rates, revenue model and plan tiers; accounts & access | `admin/*` tabs |
| **Owner**: dashboard (in/out of service, Ongoing/Upcoming/Overdue), monthly calendar with holiday + NWS rain-risk markers, reminders, unit detail (photos, info, driver, resources, OEM schedule, repairs by category, history), request service, customer profile | `(owner)/*`, `unit/[id]`, `profile`, `history` |
| **Repair activities + estimates/approvals**: request → estimate → owner approves / declines / defers → scheduled → in progress → complete | `activity/[id]`, `estimate/[id]`, workflow RPCs |
| **Accounting & invoicing (§5)**: balance due, past due, paid to date; open/paid invoices; invoice detail (labor = book hrs × rate, parts at cost, NC tax line); Pay / Pay-all through Stripe (ACH first); spend by truck; statement + year-end summary | `(owner)/accounting`, `invoice/[id]`, Edge Functions `create-checkout`, `stripe-webhook` |
| Invoice on completion; monthly plan invoice on the 1st (trucks × fee) | `complete_activity`, `generate_plan_invoices` (pg_cron) |
| **§12 Roadside / breakdown**: location, symptoms, photos, driveable/tow; urgent activity skips the scheduler; pages the provider (push + SMS); tracks response time, tow and downtime | `breakdown`, `report_breakdown`, `update_breakdown`, Edge Function `dispatch-notifications` |
| **§12 Fleet reporting**: cost per mile and per engine hour by truck, spend by category, downtime days, PM compliance, DOT-ready file per truck, PDF + CSV | `(owner)/reports`, SQL `fleet_report`, `dot_file` |
| **§12 Owner deferral**: defer with a reason; stays visible as a reminder; appears in the DOT file | `defer_interval`, `defer_activity` |
| **Inspections with checklists**: *Vehicle inspection* (annual, 49 CFR 396.17, checklist follows Appendix G: 50 items) and *Monthly in-depth inspection* (every 30 days, shop standard for dump trucks: 59 items with measured brake, air, tire and electrical readings, hoist/PTO, road test). Each is scheduled from the truck's OEM schedule or requested; performed item by item in the app (OK / Defect / Repaired on the spot / N/A, readings, notes); completing it invoices the inspection, resets the interval, and opens a defects repair activity for the owner to approve. Out-of-service (●) defects keep the truck down until repaired. Printable blank checklists and completed reports (PDF); inspections appear in the DOT file | `checklists`, `inspection/[id]`, `supabase/migrations/*inspections.sql` |
| Security: RLS on every table (admin = all, owner = own fleet, provider = managed fleets, vendor = own orders), audit log, TOTP MFA | `supabase/migrations/*security.sql`, `security` screen |

**Stubbed in the data model only** (later stages): provider workspace (`org_relationships` + `can_work_fleet` already scope it), vendors, `parts_orders`, `vendor_bills`, technicians, labor-time guide, QuickBooks sync. In stage one, Admin runs PG Heavy Duty's work queue: sending estimates, starting and completing work. Paul gets separate **admin** and **provider** memberships, so the two roles stay apart.

## Layout

```
src/app/            Expo Router screens: (owner) tabs, admin tabs, shared detail screens
src/components/     UI kit, calendar, list rows, dashboard
src/lib/            Supabase client, auth, schedule logic (due / forecasts / status), VIN, holidays + NWS, exports
supabase/migrations core schema → RLS → workflow RPCs → reporting
supabase/functions  invite-owner, create-checkout, stripe-webhook, dispatch-notifications
supabase/seed.sql   Platform, PG Heavy Duty, Shells Trucking (acct 001) with 6 trucks — SAMPLE intervals
supabase/tests      Plain-Postgres harness: 65 RLS + workflow + inspection assertions
```

## Run it

1. `npm install`
2. Create a Supabase project (or `supabase start` locally), then `supabase db push` and run `supabase/seed.sql`.
3. `cp .env.example .env.local` and fill in the URL, anon key and app URL.
4. Sign up with Paul's email in the app, then run this once in the SQL editor: `select bootstrap_platform_admin('<email>');`
5. Run `npm run web` (PWA) or `npm start` (Expo Go / dev build).

**Edge Functions:** run `supabase functions deploy` and set these secrets:
- `APP_URL`
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Point a Stripe webhook at `/functions/v1/stripe-webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`.
- `NOTIFY_WEBHOOK_SECRET`. Add a Database Webhook on INSERT into `public.notifications` that calls `dispatch-notifications` and sends the header `x-webhook-secret`.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` for breakdown SMS. Users need a phone number on their `profiles` row.
- Push needs an EAS project id (`npx eas-cli init`).

**Auth redirect URLs:** add `<APP_URL>/auth/callback` and `northgate://auth/callback`.

## Checks

```
npm run typecheck          # tsc
npm test                   # schedule / calendar / VIN unit tests (node:test)
supabase/tests/run.sh      # migrations + seed + RLS/workflow assertions on a throwaway Postgres
npm run export:web         # production PWA bundle
```

## Before Shells goes live

- **Review the inspection checklists** (`inspection_items`): the annual list follows Appendix G; the monthly list and its typical reading ranges are a starting point and should be checked against the OEM manuals.
- **Replace the SAMPLE intervals** with ones taken from the OEM manuals (manual and section in `source_ref`, link in `source_url`), then confirm each one.
- **Revenue model (§12)** is still open. It is a setting (A subscription / B fee / C both). Stripe Connect routing and the application fee are already wired: set `organizations.stripe_account_id` on PG Heavy Duty.
- **NC sales tax**: the rate defaults to 0% until the CPA confirms.
- **Mileage source** is still open. Meter readings come from manual entry or service visits; telematics can write to `meter_readings` later.
- Suspended accounts are flagged but not locked out yet.
