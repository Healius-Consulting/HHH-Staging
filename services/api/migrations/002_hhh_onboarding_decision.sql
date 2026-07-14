alter table eligibility_submissions
  drop constraint if exists eligibility_submissions_status_check;

update eligibility_submissions
set status = case
  when status = 'Completed' then 'Approved'
  when status in ('Records uploaded', 'Referred to clinic') then 'Under HHH review'
  else status
end;

alter table eligibility_submissions
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists decision_note text,
  add constraint eligibility_submissions_status_check
    check (status in ('New', 'Under HHH review', 'Approved', 'Declined'));
