import React, { useLayoutEffect, useRef, useState } from 'react';
import { captureChartPng, downloadChartPng } from '../../utils/qaqcChartPng';

export default function QaqcChartDownload({ chart, available, title, lines, filename, captureCurrent }) {
  const alive = useRef(true), running = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const download = async () => {
    if (running.current) return;
    const snapshotCurrent = captureCurrent();
    const current = () => alive.current && snapshotCurrent();
    if (!current()) return;
    running.current = true; setBusy(true); setError('');
    try {
      const capture = captureChartPng(chart.current?.querySelector('svg'), { title, lines, filename });
      await downloadChartPng(capture, current);
    } catch (e) { if (current() && e.name !== 'AbortError') setError(e.message); }
    finally { running.current = false; if (current()) setBusy(false); }
  };
  return <><button type="button" className="btn" disabled={!available || busy} onClick={download} aria-label={`Download ${title} PNG`}>{busy ? 'Preparing PNG…' : 'Download PNG'}</button>{error && <p role="alert" className="ws-error">{error}</p>}</>;
}
