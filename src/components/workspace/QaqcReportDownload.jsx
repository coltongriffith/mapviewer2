import React, { useLayoutEffect, useRef, useState } from 'react';
import { buildQaqcReport, layoutQaqcReport } from '../../../shared/qaqcReport';
import { captureQaqcReportCharts, measureQaqcReport } from '../../utils/qaqcReportCapture';

export default function QaqcReportDownload({ kind, snapshot, analysis, propertyName, chartRefs, captureCurrent }) {
  const alive = useRef(true), running = useRef(false);
  const [progress, setProgress] = useState(null), [error, setError] = useState('');
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const download = async () => {
    if (running.current) return;
    const snapshotCurrent = captureCurrent(), current = () => alive.current && snapshotCurrent();
    if (!current()) return;
    running.current = true; setError(''); setProgress('Preparing comparison PDF…');
    try {
      const generatedAt = new Date().toISOString();
      const charts = captureQaqcReportCharts(Object.fromEntries(Object.entries(chartRefs).map(([key, ref]) => [key, ref.current?.querySelector('svg')])));
      // The pure adapter owns the selected evidence and metadata before the
      // first await. Unselected batch rows are not copied into the report.
      const report = buildQaqcReport({ kind, snapshot, analysis, propertyName, generatedAt, chartAvailability: Object.fromEntries(Object.entries(charts).map(([key, chart]) => [key, { available: true, width: chart.width, height: chart.height }])) });
      const layout = layoutQaqcReport(report, { measureText: measureQaqcReport() });
      const captured = { layout, charts, filename: `qaqc-${kind}-${analysis.scope.batchId}.pdf`, generatedAt };
      const { downloadQaqcReportPdf } = await import('../../utils/qaqcReportPdf');
      if (!current()) return;
      await downloadQaqcReportPdf(captured, { isCurrent: current, onProgress: ({ page, total }) => { if (current()) setProgress(`Preparing PDF page ${page} of ${total}…`); } });
    } catch (e) { if (current() && e.name !== 'AbortError') setError(e.message); }
    finally { running.current = false; if (current()) setProgress(null); }
  };
  if (!analysis.selectedCount) return <p>No selected controls to include in a comparison PDF.</p>;
  return <div><button type="button" className="btn" disabled={progress !== null} onClick={download}>Download comparison PDF</button>{progress && <p role="status">{progress}</p>}{analysis.eligibleCount === 0 && <p className="dash-muted">The PDF will contain the selected evidence and exclusion reasons; no assessed chart is available.</p>}{error && <p role="alert" className="ws-error">{error}</p>}</div>;
}
