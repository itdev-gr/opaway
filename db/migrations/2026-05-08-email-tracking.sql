-- Email-sent timestamps for transactional email idempotency.
-- Each *_sent_at column is set the first time the corresponding email is
-- sent so retries (Stripe webhooks, double-clicks, manual replays) don't
-- duplicate-send. Idempotent and additive — safe to run on a live DB.

alter table public.transfers   add column if not exists confirmation_email_sent_at timestamptz;
alter table public.transfers   add column if not exists review_email_sent_at       timestamptz;

alter table public.tours       add column if not exists confirmation_email_sent_at timestamptz;
alter table public.tours       add column if not exists review_email_sent_at       timestamptz;

alter table public.experiences add column if not exists confirmation_email_sent_at timestamptz;
alter table public.experiences add column if not exists review_email_sent_at       timestamptz;

alter table public.requests    add column if not exists confirmation_email_sent_at timestamptz;
alter table public.partners    add column if not exists confirmation_email_sent_at timestamptz;
