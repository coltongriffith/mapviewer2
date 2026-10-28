import React, { Suspense, useState } from 'react';
import { lazyGuarded } from '../utils/preloadGuard';

const ProjectDataDownload = lazyGuarded(() => import('./ProjectDataDownload'));

export default function ProjectDataDownloadButton({ project }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="dash-icon-btn" type="button" aria-label={`Download data from ${project.name || 'map'}`} onClick={() => setOpen(true)}>Download data</button>
    {open && <Suspense fallback={<span role="status">Loading downloads…</span>}>
      <ProjectDataDownload project={project} onClose={() => setOpen(false)} />
    </Suspense>}
  </>;
}
