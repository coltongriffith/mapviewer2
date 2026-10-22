import { useEffect, useState } from 'react';

// The drill plan's legend rows (utils/drillPlanLegend.js) for the editor and the shared map page, loaded with the
// first map that has a plan. A map without one gets the same empty list every render, so its legend, zones and
// exports are untouched.
const NONE = [];
export function useLazyDrillLegend(plan) {
  const [rows, setRows] = useState(NONE);
  useEffect(() => {
    if (!plan) { setRows(NONE); return undefined; }
    let live = true;
    import('./drillPlanLegend.js').then((m) => { if (live) setRows(m.drillPlanLegendItems(plan)); }, () => {});
    return () => { live = false; };
  }, [plan]);
  return plan ? rows : NONE;
}
