-- ============================================================
-- Stripe event ledger + authoritative invoice state.
--
-- Two gaps this closes:
--
--   P1-08  No event ledger or ordering protection. A redelivered webhook
--          re-applied its side effects, and an out-of-order subscription
--          event could overwrite newer state with older. Operators had no
--          record of what was processed.
--
--   P1-29  The invoice mirror stored one mutually exclusive display label.
--          No handler created an `open` row, ANY credit note marked the whole
--          invoice 'credited', and ANY refund marked it fully 'refunded', so
--          a $10 credit on a $10,000 invoice looked identical to a full one.
--
-- Rollback:
--   drop table if exists public.stripe_events;
--   alter table public.custom_invoices
--     drop column if exists amount_remaining,
--     drop column if exists amount_refunded,
--     drop column if exists amount_credited,
--     drop column if exists last_event_at;
-- ============================================================

-- ── Event ledger ───────────────────────────────────────────────────────────
create table if not exists public.stripe_events (
  event_id text primary key,
  event_type text not null,
  event_created timestamptz not null,
  processed_at timestamptz not null default now(),
  outcome text not null default 'ok' check (outcome in ('ok', 'skipped', 'failed')),
  detail text
);

alter table public.stripe_events enable row level security;
revoke all on table public.stripe_events from anon, authenticated;
-- Service role only: the webhook writes it, nothing else reads it.

create index if not exists stripe_events_type_idx on public.stripe_events (event_type, event_created desc);

-- ── Authoritative money columns ────────────────────────────────────────────
alter table public.custom_invoices
  add column if not exists amount_remaining integer not null default 0,
  add column if not exists amount_refunded integer not null default 0,
  add column if not exists amount_credited integer not null default 0,
  -- Stripe event timestamp of the last event applied to this row. Used to
  -- drop stale, out-of-order deliveries instead of regressing status.
  add column if not exists last_event_at timestamptz;

-- 'open' and 'partially_refunded' were unrepresentable before.
alter table public.custom_invoices drop constraint if exists custom_invoices_status_check;
alter table public.custom_invoices add constraint custom_invoices_status_check
  check (status in (
    'draft', 'open', 'paid', 'payment_failed', 'void', 'uncollectible',
    'refunded', 'partially_refunded', 'credited', 'partially_credited'
  ));

comment on column public.custom_invoices.status is
  'Mirrors Stripe''s invoice status plus refund/credit qualifiers. Amounts are authoritative; status is a label.';
