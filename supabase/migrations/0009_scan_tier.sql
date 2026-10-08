-- Scrivn Scan on its own (2026-10-08): a fourth value for profiles.subscription_tier.
--
-- 'scan' is the Scan-only plan, sold on scrivn.ca through Stripe (SCAN_PLAN in lib/plans.ts). It is
-- not a Scrivn plan: it carries no claims, so lib/usage.ts treats it as no plan for claims (the free
-- trial, then View plans), and what it unlocks is on the phone. The webhook writes it the way it
-- writes the others; nothing else changes - users still cannot write this column (0002).
--
-- Run in the Supabase SQL editor. Safe to run twice.

alter table public.profiles drop constraint if exists profiles_subscription_tier_check;
alter table public.profiles add constraint profiles_subscription_tier_check
  check (subscription_tier is null or subscription_tier in ('starter', 'growth', 'unlimited', 'scan'));
