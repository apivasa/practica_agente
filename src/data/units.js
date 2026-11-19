// Unidades (lectura). RLS: gestora, comité y custodios leen todas.
import { db, raise, MSG_LOAD } from './client.js';

export async function listUnits() {
  const { data, error } = await db().from('units').select('id, name').order('name');
  if (error) raise(error, MSG_LOAD);
  return data ?? [];
}
