import { useEffect, useState } from 'react';
import { estimateStorageUsedBytes } from '../utils/projectStorage';

// Storage can contain megabytes of map geometry. Read it after writes, never
// during an editor render (typing, hovering and dragging used to rescan it).
export function useStorageUsage(enabled) {
  const [bytes, setBytes] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let timer;
    const measure = () => setBytes(estimateStorageUsedBytes());
    const schedule = () => { clearTimeout(timer); timer = setTimeout(measure, 500); };
    measure();
    window.addEventListener('project-storage-updated', schedule);
    window.addEventListener('storage', schedule);
    window.addEventListener('focus', schedule);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('project-storage-updated', schedule);
      window.removeEventListener('storage', schedule);
      window.removeEventListener('focus', schedule);
    };
  }, [enabled]);
  return bytes;
}
