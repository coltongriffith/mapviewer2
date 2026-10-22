// Illustrative Tower-like drill data for the 2D drill plan (utils/drillPlan.js): holes 077 (−50°) and 078 (−70°)
// drilled northwest from one pad, a discovery hole 055 with downhole surveys, a few older holes, 2 m assays and a
// published-results table with domain headings and "incl." intervals. Collars in NAD83 / UTM zone 10N.
export const CRS = 'EPSG:26910';

const COLLARS = [
  ['077', 663420, 5607760, 905, 315, -50, 420],
  ['078', 663422, 5607761, 905, 315, -70, 400],
  ['055', 663300, 5607880, 912, 315, -55, 300],
  ['059', 663235, 5607905, 915, 135, -60, 260],
  ['060', 663475, 5607845, 903, 300, -55, 240],
  ['063', 663330, 5607955, 911, 160, -65, 220],
  ['064', 663475, 5607985, 908, 200, -60, 280],
  ['065', 663335, 5608030, 914, 170, -55, 250],
  ['068', 663440, 5607900, 906, 225, -50, 230],
];
export const COLLARS_CSV = ['HoleID,Easting,Northing,Elevation,Azimuth,Dip,Depth', ...COLLARS.map((r) => r.join(','))].join('\n');

// 055 curves slightly with depth (desurveyed); the others are straight from their collar azimuth and dip.
export const SURVEYS_CSV = ['HoleID,Depth,Azimuth,Dip', '055,0,315,-55', '055,100,318,-53', '055,200,322,-51', '055,300,326,-49'].join('\n');

// 2 m assays down 077, 078 and 055: background, then the zones the release reports.
const ZONES = {
  '077': [[30, 50.3, 3.13], [36, 44, 7.16], [200, 334, 0.65], [250, 251.5, 16.7]],
  '078': [[40, 90.3, 1.07], [52, 55.6, 4.15], [70, 80, 2.29], [230, 344.5, 0.44], [300, 301.4, 7.13]],
  '055': [[20, 218.75, 0.69], [140, 171.5, 4.15]],
};
function assays() {
  const rows = ['HoleID,From,To,Au_gpt,Cu_pct'];
  for (const [id, zones] of Object.entries(ZONES)) {
    const depth = COLLARS.find((c) => c[0] === id)[6];
    for (let f = 0; f < depth; f += 2) {
      const t = Math.min(depth, f + 2), mid = (f + t) / 2;
      const hit = zones.filter(([a, b]) => mid >= a && mid < b).pop();
      const au = hit ? hit[2] : 0.05 + ((f * 7) % 10) / 100;
      rows.push(`${id},${f},${t},${au.toFixed(2)},${(0.02 + ((f * 3) % 7) / 100).toFixed(3)}`);
    }
  }
  return rows.join('\n');
}
export const ASSAYS_CSV = assays();

export const RESULTS_CSV = [
  'Result ID,Hole ID,From,To,Published length,Grade,Analyte,Unit,Parent result,Approved text,Release date,Approval status,Domain',
  '077-U,077,30,50.3,20.3,3.13,Au,g/t,,20.3 m @ 3.13 g/t Au,15 Oct 2026,approved,Upper Blue Sky',
  '077-U1,077,36,44,8.0,7.16,Au,g/t,077-U,incl. 8.0 m @ 7.16 g/t Au,15 Oct 2026,approved,',
  '077-L,077,200,334,134.0,0.65,Au,g/t,,134.0 m @ 0.65 g/t Au,15 Oct 2026,approved,Lower Blue Sky',
  '077-L1,077,250,251.5,1.5,16.70,Au,g/t,077-L,incl. 1.5 m @ 16.70 g/t Au,15 Oct 2026,approved,',
  '078-U,078,40,90.3,50.3,1.07,Au,g/t,,50.3 m @ 1.07 g/t Au,15 Oct 2026,approved,Upper Blue Sky',
  '078-U1,078,52,55.6,3.6,4.15,Au,g/t,078-U,incl. 3.6 m @ 4.15 g/t Au,15 Oct 2026,approved,',
  '078-U2,078,70,80,10.0,2.29,Au,g/t,078-U,incl. 10.0 m @ 2.29 g/t Au,15 Oct 2026,approved,',
  '078-L,078,230,344.5,114.5,0.44,Au,g/t,,114.5 m @ 0.44 g/t Au,15 Oct 2026,approved,Lower Blue Sky',
  '078-L1,078,300,301.4,1.4,7.13,Au,g/t,078-L,incl. 1.4 m @ 7.13 g/t Au,15 Oct 2026,approved,',
].join('\n');

// A saved 3D figure's settings with section A–A′ fixed through the pad (its ends in the collars' grid).
export const FIGURE_SETTINGS = {
  v: 1, app: 'Exploration Maps 3D',
  settings: { crs: CRS, sections: [{ id: 'A', name: 'A–A′', az: 135, width: 75, a: { x: 663200, y: 5608010 }, b: { x: 663500, y: 5607700 } }, { id: 'B', name: 'B–B′', az: 45, width: 75 }] },
};
