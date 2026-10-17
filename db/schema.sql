-- MitochronAi Lab · database schema v0.1 (PostgreSQL / Supabase)
-- Every tenant-owned table carries lab_id. Row-level security (RLS) makes a
-- lab's rows visible only to that lab's members. Isolation is enforced by the
-- database, not by application code.

create extension if not exists pgcrypto;

-- ─── Tenancy ────────────────────────────────────────────────────────────────
create table labs (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  address         text,
  phone           text,
  working_days    text not null default 'Mon-Sat',
  opening_time    time not null default '08:00',
  closing_time    time not null default '18:00',
  assistant_name  text not null default 'Gaya',
  comments_enabled boolean not null default false,   -- optional AI-drafted comments (off by default)
  created_at      timestamptz not null default now()
);

-- Links a signed-in user (Supabase auth.users) to a lab, with a role.
create table lab_members (
  lab_id   uuid not null references labs(id) on delete cascade,
  user_id  uuid not null,
  role     text not null check (role in ('scientist','chief_scientist','admin','viewer')),
  primary key (lab_id, user_id)
);

-- ─── People and duty ────────────────────────────────────────────────────────
create table staff (
  id            uuid primary key default gen_random_uuid(),
  lab_id        uuid not null references labs(id) on delete cascade,
  user_id       uuid,                                  -- null until the person has a login
  display_name  text not null,
  role          text not null check (role in ('scientist','chief_scientist','admin')),
  reg_no        text,                                  -- professional registration number
  active        boolean not null default true
);

create table duty_roster (
  id         uuid primary key default gen_random_uuid(),
  lab_id     uuid not null references labs(id) on delete cascade,
  staff_id   uuid not null references staff(id) on delete cascade,
  weekday    smallint not null check (weekday between 1 and 7),   -- ISO: 1 = Monday
  unique (staff_id, weekday)
);

create table patients (
  id              uuid primary key default gen_random_uuid(),
  lab_id          uuid not null references labs(id) on delete cascade,
  lab_patient_id  text not null,                       -- e.g. MCA-2026-0001
  full_name       text not null,
  sex             text not null check (sex in ('F','M')),
  date_of_birth   date,                                -- also used as the PDF password (DDMMYYYY)
  email           text,
  phone           text,
  risk_factors    text[] not null default '{}',        -- e.g. {'HIV','immunosuppression','recent_TB_contact'}
  created_at      timestamptz not null default now(),
  unique (lab_id, lab_patient_id)
);

-- ─── What the lab offers ────────────────────────────────────────────────────
create table test_catalog (
  id            uuid primary key default gen_random_uuid(),
  lab_id        uuid not null references labs(id) on delete cascade,
  code          text not null,                         -- e.g. FBG, TC, LDL, HB, MANTOUX
  name          text not null,
  department    text not null,                         -- Clinical Chemistry, Haematology, ...
  specimen      text not null,
  result_type   text not null check (result_type in ('numeric','qualitative','text')),
  unit          text,                                  -- ONE canonical unit per test
  ref_low       numeric,
  ref_high      numeric,
  ref_sex       text check (ref_sex in ('F','M')),     -- null = applies to both
  ref_text      text,                                  -- human-readable range or expected result
  ref_source    text,                                  -- WHO, NCEP ATP III, lab-validated, ...
  calc_formula  text,                                  -- e.g. 'friedewald_mmol' when derived
  sop_document_id uuid,
  unique (lab_id, code, ref_sex)
);

-- ─── Work ───────────────────────────────────────────────────────────────────
create table orders (
  id            uuid primary key default gen_random_uuid(),
  lab_id        uuid not null references labs(id) on delete cascade,
  patient_id    uuid not null references patients(id),
  requested_by  text,                                  -- referring clinician
  received_at   timestamptz not null,
  fasting_hours numeric,
  status        text not null check (status in ('received','in_progress','awaiting_approval','released','rejected')),
  reject_reason text
);

create table results (
  id            uuid primary key default gen_random_uuid(),
  lab_id        uuid not null references labs(id) on delete cascade,
  order_id      uuid not null references orders(id) on delete cascade,
  test_code     text not null,
  collected_at  timestamptz not null,
  tested_at     timestamptz,
  read_at       timestamptz,                           -- timed tests (Mantoux)
  performed_by  uuid references staff(id),
  value_numeric numeric,
  value_text    text,
  unit          text,
  value_source  text check (value_source in ('measured','calculated')),
  flag          text check (flag in ('N','L','H','C','POS','NEG')),
  status        text not null check (status in ('pending','entered','awaiting_approval','approved','released')),
  approved_by   uuid references staff(id),
  approved_at   timestamptz,
  released_at   timestamptz,
  comment       text,                                  -- optional; only if labs.comments_enabled
  comment_author text check (comment_author in ('scientist','gaya_draft'))
);

-- ─── Quality control ────────────────────────────────────────────────────────
create table qc_runs (
  id           uuid primary key default gen_random_uuid(),
  lab_id       uuid not null references labs(id) on delete cascade,
  analyser     text not null,
  test_code    text not null,
  level        text not null,                          -- L1, L2
  run_at       timestamptz not null,
  value        numeric not null,
  target_mean  numeric not null,
  target_sd    numeric not null,
  run_by       uuid references staff(id)
);

-- ─── Documents Gaya reads ───────────────────────────────────────────────────
create table documents (
  id            uuid primary key default gen_random_uuid(),
  lab_id        uuid not null references labs(id) on delete cascade,
  kind          text not null check (kind in ('sop','template','policy','standard')),
  title         text not null,
  version       text,
  review_due    date,
  storage_path  text not null,                         -- per-lab storage bucket path
  uploaded_at   timestamptz not null default now()
);

-- ─── Audit (append-only) ────────────────────────────────────────────────────
create table audit_log (
  id          bigint generated always as identity primary key,
  lab_id      uuid not null references labs(id) on delete cascade,
  at          timestamptz not null default now(),
  actor_type  text not null check (actor_type in ('human','gaya','system')),
  actor_id    uuid,
  action      text not null,                           -- e.g. report.drafted, report.approved, email.sent, discrepancy.raised
  entity      text,
  entity_id   uuid,
  model       text,                                    -- which model source acted (local/byo/connect) when actor_type = 'gaya'
  details     jsonb not null default '{}'
);

-- Nobody can edit or delete audit history, not even admins.
create or replace function audit_log_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_no_update before update or delete on audit_log
  for each row execute function audit_log_immutable();

-- ─── Row-level security ─────────────────────────────────────────────────────
create or replace function is_lab_member(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from lab_members m where m.lab_id = target and m.user_id = auth.uid());
$$;

do $$
declare t text;
begin
  foreach t in array array['staff','duty_roster','patients','test_catalog','orders','results','qc_runs','documents','audit_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (is_lab_member(lab_id))', t || '_read', t);
    execute format('create policy %I on %I for insert with check (is_lab_member(lab_id))', t || '_insert', t);
  end loop;
  foreach t in array array['staff','duty_roster','patients','test_catalog','orders','results','qc_runs','documents'] loop
    execute format('create policy %I on %I for update using (is_lab_member(lab_id)) with check (is_lab_member(lab_id))', t || '_update', t);
  end loop;
end $$;

alter table labs enable row level security;
create policy labs_read on labs for select using (is_lab_member(id));
alter table lab_members enable row level security;
create policy members_read on lab_members for select using (user_id = auth.uid());

-- Only a chief scientist may approve or release a result.
create or replace function enforce_approver() returns trigger language plpgsql as $$
begin
  if new.status in ('approved','released') then
    if new.approved_by is null then
      raise exception 'a named approver is required before approval or release';
    end if;
    if not exists (select 1 from staff s where s.id = new.approved_by and s.lab_id = new.lab_id and s.role = 'chief_scientist' and s.active) then
      raise exception 'approver must be an active chief scientist of this lab';
    end if;
  end if;
  return new;
end $$;
create trigger results_approver before insert or update on results
  for each row execute function enforce_approver();
