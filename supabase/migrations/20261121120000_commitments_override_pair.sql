-- M-03 (H-1): el umbral negociado va en pareja. Un override a medias no tiene
-- regla de negocio (engine/effectiveThresholds lo descarta), así que la BD lo
-- impide. Aditiva: la semilla y los datos existentes no tienen overrides a medias.
alter table public.commitments
  add constraint commitments_override_pair
  check ((green_override is null) = (yellow_override is null));
