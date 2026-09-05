import { useEffect } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { trackPageView, trackPing } from '../utils/track';

export default function SessionTelemetry() {
  const { loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    const entry = window.emAcquisition?.entry || { path: window.location.pathname };
    const key = `em_pageview:${entry.path}`;
    let recorded = false;
    try { recorded = Boolean(sessionStorage.getItem(key)); } catch { /* optional */ }
    if (!recorded) {
      // Mark before sending to avoid StrictMode's double effect; undo on failure.
      try { sessionStorage.setItem(key, '1'); } catch { /* optional */ }
      trackPageView({ path: entry.path, referrer: entry.referrer, utmSource: entry.utm_source,
        utmMedium: entry.utm_medium, utmCampaign: entry.utm_campaign,
        device: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop' })
        .then((ok) => { if (!ok) try { sessionStorage.removeItem(key); } catch { /* optional */ } });
    }
    const ping = () => { if (document.visibilityState === 'visible') trackPing(); };
    ping();
    const timer = setInterval(ping, 25000);
    document.addEventListener('visibilitychange', ping);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', ping); };
  }, [loading]);
  return null;
}
