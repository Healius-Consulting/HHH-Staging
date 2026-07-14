insert into organisations (id, slug, name, trading_name, logo_text, gphc_number, superintendent, address, status) values
('11111111-1111-4111-8111-111111111111', 'hhh-leeds', 'Holistic Health Hub Pharmacy — Leeds', 'HHH Leeds', 'HH', '9012345', 'Shaylen Patel', 'Leeds, West Yorkshire, United Kingdom', 'live'),
('22222222-2222-4222-8222-222222222222', 'east-midlands-lincoln', 'East Midlands Pharmacy Lincoln', 'EMP Lincoln', 'EM', '9019876', 'A. Pharmacist', 'Lincoln, Lincolnshire, United Kingdom', 'onboarding')
on conflict (id) do nothing;

insert into referral_tokens (organisation_id, token_hash) values
('11111111-1111-4111-8111-111111111111', '2de806fa7e475293e1de489cb35acb05388144044869b60e269c5d5b4eb05611'),
('22222222-2222-4222-8222-222222222222', '1a0a16d9f300b83ed16a3a3767f83f8610016f5b263f9a1a772a9ee0c7d4cb2f')
on conflict (token_hash) do nothing;
