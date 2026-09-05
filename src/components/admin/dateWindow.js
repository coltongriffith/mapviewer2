export const DASHBOARD_TZ = 'America/Vancouver';
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DASHBOARD_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const clockFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DASHBOARD_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
// B.C. adopted permanent UTC-7 on March 8, 2026. Older browsers still
// predict a November rollback. Keep post-transition reporting deterministic.
// https://news.gov.bc.ca/releases/2026AG0013-000209
export function pacificDate(now = new Date()) {
  if (+now >= Date.parse('2026-03-08T10:00:00Z')) return new Date(+now - 7 * 3600000).toISOString().slice(0, 10);
  const p = Object.fromEntries(dateFormatter.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function addCalendarDays(day, days) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// Resolve each boundary using the zone's actual offset. Days crossing DST
// are 23 or 25 hours; a fixed UTC offset cannot represent local midnight.
export function pacificMidnight(day) {
  if (day >= '2026-03-09') return `${day}T07:00:00.000Z`;
  const target = Date.parse(`${day}T00:00:00Z`);
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(clockFormatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
    const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    instant += target - local;
  }
  return new Date(instant).toISOString();
}
export function dashboardWindow(range, now = new Date()) {
  const end = pacificDate(now);
  return { p_start: pacificMidnight(addCalendarDays(end, -range)), p_end: pacificMidnight(end) };
}
export function dayWindow(day) {
  return { p_start: pacificMidnight(day), p_end: pacificMidnight(addCalendarDays(day, 1)) };
}
