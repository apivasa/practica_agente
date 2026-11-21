// QA V-07: lo lanza tests/engine/qa-v07.test.js con otra TZ en un proceso hijo.
// Imprime la zona efectiva y las fechas importadas de cada fixture.
import { parseMeasurementsXlsx } from '../../../engine/index.js';
import { inflateRaw } from '../../../src/lib/inflate.js';
import { fixture } from './ooxml.js';

const units = [{ id: 'u-alfa', name: 'Unidad Alfa' }, { id: 'u-beta', name: 'Unidad Beta' }];
const ind = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.9, yellow: 99.5 } };
const dates = {};
for (const name of ['avail.xlsx', 'avail-1904.xlsx', 'avail-hora.xlsx', 'avail-libreoffice.xlsx']) {
  const b = fixture(name);
  const r = await parseMeasurementsXlsx(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), ind, { units, today: '2026-11-20' }, inflateRaw);
  dates[name] = r.errors.length ? r.errors : r.rows.map((x) => x.date);
}
process.stdout.write(JSON.stringify({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: new Date('2026-01-05T12:00:00Z').getTimezoneOffset(), dates }));
