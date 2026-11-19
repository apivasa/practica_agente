-- F-03: modelo de datos (enums, tablas, restricciones e índices).
-- Las políticas RLS y los permisos van en la migración siguiente (F-04);
-- aquí ya se activa RLS en cada tabla para que ninguna quede abierta.

-- ---------------------------------------------------------------------------
-- Enums (valores alineados con engine/)
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('kpi_manager', 'custodian', 'committee', 'unit_leader');
create type public.measurement_type as enum ('cumulative_target', 'window_average', 'coverage');
create type public.direction as enum ('higher_is_better', 'lower_is_better');
create type public.frequency as enum ('monthly', 'weekly', 'quarterly');
create type public.data_source as enum ('manual', 'automatic');
create type public.color as enum ('green', 'yellow', 'red', 'not_evaluated');
create type public.escalation_level as enum ('normal', 'restricted', 'frozen', 'exception');
create type public.exception_scope as enum ('change_start', 'all');

-- ---------------------------------------------------------------------------
-- Unidades
-- ---------------------------------------------------------------------------
create table public.units (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  leader_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.units enable row level security;
create index units_leader_user_id_idx on public.units (leader_user_id);

-- ---------------------------------------------------------------------------
-- Indicadores (modelo genérico)
-- ---------------------------------------------------------------------------
create table public.indicators (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Za-z0-9_-]+$'),
  name text not null check (length(trim(name)) > 0),
  description text,
  measurement_type public.measurement_type not null,
  direction public.direction not null,
  window_days integer not null default 30 check (window_days > 0),
  green_threshold numeric not null,
  yellow_threshold numeric not null,
  thresholds_by_category jsonb not null default '{}'::jsonb
    check (jsonb_typeof(thresholds_by_category) = 'object'),
  frequency public.frequency not null default 'monthly',
  min_sample integer not null default 0 check (min_sample >= 0),
  source public.data_source not null default 'manual',
  custodian_user_id uuid references auth.users (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  -- Coherencia de umbrales: con "más es mejor" verde >= amarillo; con
  -- "menos es mejor" verde <= amarillo.
  constraint indicators_thresholds_coherent check (
    (direction = 'higher_is_better' and green_threshold >= yellow_threshold)
    or (direction = 'lower_is_better' and green_threshold <= yellow_threshold)
  )
);
alter table public.indicators enable row level security;
create index indicators_custodian_user_id_idx on public.indicators (custodian_user_id);

-- ---------------------------------------------------------------------------
-- Usuarios y roles
-- Un líder va ligado a una unidad; un custodio, a un indicador; gestora y
-- comité no llevan ninguno.
-- ---------------------------------------------------------------------------
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  unit_id uuid references public.units (id) on delete cascade,
  indicator_id uuid references public.indicators (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_roles_scope check (
    case role
      when 'unit_leader' then unit_id is not null and indicator_id is null
      when 'custodian' then indicator_id is not null and unit_id is null
      else unit_id is null and indicator_id is null
    end
  ),
  constraint user_roles_unique unique nulls not distinct (user_id, role, unit_id, indicator_id)
);
alter table public.user_roles enable row level security;
create index user_roles_user_id_idx on public.user_roles (user_id, role);
create index user_roles_unit_id_idx on public.user_roles (unit_id);
create index user_roles_indicator_id_idx on public.user_roles (indicator_id);

-- ---------------------------------------------------------------------------
-- Compromisos: umbrales o metas negociadas por unidad, indicador y periodo
-- ---------------------------------------------------------------------------
create table public.commitments (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units (id) on delete cascade,
  indicator_id uuid not null references public.indicators (id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-(Q[1-4]|0[1-9]|1[0-2])$'),
  green_override numeric,
  yellow_override numeric,
  package_total numeric check (package_total is null or package_total >= 0),
  notes text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commitments_unique unique (unit_id, indicator_id, period)
);
alter table public.commitments enable row level security;
create index commitments_indicator_id_idx on public.commitments (indicator_id, period);

-- ---------------------------------------------------------------------------
-- Mediciones
-- ---------------------------------------------------------------------------
create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units (id) on delete cascade,
  indicator_id uuid not null references public.indicators (id) on delete cascade,
  measured_on date not null,
  value numeric check (value is null or value >= 0),
  app_id text,
  compliant boolean,
  category text,
  source public.data_source not null default 'manual',
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.measurements enable row level security;
create index measurements_unit_indicator_date_idx
  on public.measurements (unit_id, indicator_id, measured_on);
create index measurements_indicator_date_idx on public.measurements (indicator_id, measured_on);

-- ---------------------------------------------------------------------------
-- Metas parciales mensuales
-- ---------------------------------------------------------------------------
create table public.targets (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units (id) on delete cascade,
  indicator_id uuid not null references public.indicators (id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  target_value numeric not null check (target_value >= 0),
  created_at timestamptz not null default now(),
  constraint targets_unique unique (unit_id, indicator_id, month)
);
alter table public.targets enable row level security;
create index targets_indicator_month_idx on public.targets (indicator_id, month);

-- ---------------------------------------------------------------------------
-- Evaluaciones: color por unidad, indicador y mes (indicator_id null = color
-- global de la unidad). Solo las escribe el backend.
-- ---------------------------------------------------------------------------
create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units (id) on delete cascade,
  indicator_id uuid references public.indicators (id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  color public.color not null,
  value numeric,
  sample_size integer not null default 0 check (sample_size >= 0),
  reason text,
  escalation_level public.escalation_level,
  restrictions text[] not null default '{}',
  evaluated_at timestamptz not null default now(),
  constraint evaluations_unique unique nulls not distinct (unit_id, indicator_id, month)
);
alter table public.evaluations enable row level security;
create index evaluations_unit_month_idx on public.evaluations (unit_id, month);
create index evaluations_indicator_month_idx on public.evaluations (indicator_id, month);

-- ---------------------------------------------------------------------------
-- Excepciones aprobadas por el comité
-- ---------------------------------------------------------------------------
create table public.exceptions (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units (id) on delete cascade,
  scope public.exception_scope not null default 'change_start',
  reason text not null check (length(trim(reason)) > 0),
  expires_on date not null,
  approved_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.exceptions enable row level security;
create index exceptions_unit_expires_idx on public.exceptions (unit_id, expires_on);

-- ---------------------------------------------------------------------------
-- Alertas: qué se notificó, a quién y cuándo. Solo las inserta el backend.
-- ---------------------------------------------------------------------------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references public.units (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (length(trim(kind)) > 0),
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.alerts enable row level security;
create index alerts_recipient_sent_idx on public.alerts (recipient_user_id, sent_at desc);
create index alerts_unit_sent_idx on public.alerts (unit_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- Auditoría: toda acción con efecto. Solo inserción (backend o triggers).
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigserial primary key,
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
create index audit_log_entity_idx on public.audit_log (entity, entity_id, created_at desc);
create index audit_log_created_at_idx on public.audit_log (created_at desc);
