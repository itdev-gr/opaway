-- Multi-day tour bookings now record the customer's hotel preference
-- ('self-book' = I'll arrange my own / 'include-booking' = agent contacts me).
-- Only populated when the tours_catalog row has hotel_option != 'none'.
-- Idempotent.

alter table public.tours
  add column if not exists hotel_choice text
    check (hotel_choice is null or hotel_choice in ('self-book', 'include-booking'));
