-- H-C03-04 (aditiva): measurements.created_at lo fija la BD al insertar. Se usa como
-- desempate de orden (cobertura); el usuario no debe poder elegirlo. UPDATE ya no lo
-- concede (grant por columnas en 20261119120300_hardening.sql).

create or replace function private.force_created_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  return new;
end;
$$;
revoke all on function private.force_created_at() from public, anon, authenticated;

create trigger measurements_force_created_at
  before insert on public.measurements
  for each row execute function private.force_created_at();
