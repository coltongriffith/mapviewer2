// File names for the package export (item 40): Client_Project_Date_FigN_Name_vX.png, and the package's PDF and
// ZIP as Client_Project_Date_Package_vX. Each part keeps letters, digits and hyphens only (spaces and other
// characters become one hyphen, accents are dropped), so the names survive any file system, email or upload.

export const namePart = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

const head = ({ client, project, date }) => [client, project, date].map(namePart).filter(Boolean);
const ver = (v) => `v${namePart(String(v ?? '').replace(/^v/i, '')) || '1'}`;

/** meta: { client, project, date, version }; n: the figure's number from 1; name: the figure's own name. */
export function figureFileName(meta, n, name, ext = 'png') {
  return `${[...head(meta), `Fig${n}`, namePart(name)].filter(Boolean).join('_')}_${ver(meta.version)}.${ext}`;
}

export function packageFileName(meta, ext) {
  return `${[...head(meta), 'Package'].join('_')}_${ver(meta.version)}.${ext}`;
}

/** Today as YYYY-MM-DD in local time: the package's default date. */
export function todayStamp(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
