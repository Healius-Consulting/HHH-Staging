create extension if not exists pgcrypto;

create table organisations (
  id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null,
  trading_name text not null, logo_text varchar(4) not null, gphc_number text not null,
  superintendent text not null, address text not null,
  status text not null check (status in ('live', 'onboarding', 'paused')),
  created_at timestamptz not null default now()
);

create table referral_tokens (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references organisations(id),
  token_hash char(64) not null unique, label text not null default 'Primary eligibility link',
  created_at timestamptz not null default now(), revoked_at timestamptz
);

create table eligibility_submissions (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references organisations(id),
  referral_token_id uuid not null references referral_tokens(id), first_name text not null, surname text not null,
  dob date not null, mobile text not null, email text not null, postcode text not null, condition text not null,
  tried_two_treatments boolean not null, psychosis_exclusion boolean not null,
  consent_referral boolean not null, consent_share boolean not null, marketing_consent boolean not null default false,
  source text not null, status text not null default 'New' check (status in ('New', 'Under HHH review', 'Approved', 'Declined')),
  reviewed_at timestamptz, reviewed_by text, decision_note text,
  consent_captured_at timestamptz not null, request_ip inet, request_user_agent text,
  submitted_at timestamptz not null default now()
);

create index eligibility_submissions_tenant_date_idx on eligibility_submissions (organisation_id, submitted_at desc);
create index eligibility_submissions_tenant_email_idx on eligibility_submissions (organisation_id, lower(email));
alter table eligibility_submissions enable row level security;
