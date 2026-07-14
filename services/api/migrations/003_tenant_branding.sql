alter table organisations
  add column if not exists brand_primary varchar(7) not null default '#0f766e';

alter table organisations
  drop constraint if exists organisations_brand_primary_hex;

alter table organisations
  add constraint organisations_brand_primary_hex
  check (brand_primary ~ '^#[0-9A-Fa-f]{6}$');

update organisations set brand_primary = '#315b7d'
where id = '22222222-2222-4222-8222-222222222222';
