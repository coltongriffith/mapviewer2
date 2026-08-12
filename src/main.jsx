import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
// Leaflet's stylesheet is not imported here: MapCanvas and TenureMap both
// import it themselves, and both are React.lazy.
//
// NOTE this does not yet get it off the critical path. PageSpeed flags
// vendor-leaflet CSS as render-blocking on the landing page, which has no map,
// and it still is — App.jsx imports `leaflet` directly, so the vendor-leaflet
// chunk stays in the initial graph and Vite links its stylesheet eagerly.
// Removing the import here is a prerequisite for that fix, not the fix; the
// remaining work is decoupling App.jsx from Leaflet, which is a real refactor
// rather than a build tweak.
import { exportLeadsCsv } from "./utils/leadCapture";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider } from "./hooks/useAuth.jsx";
import RecoveryGate from "./components/RecoveryGate";
import { captureAttribution } from "./utils/attribution";
import { inject } from "@vercel/analytics";
import { installErrorReporting } from "./utils/errorReporter";

// Record first-touch acquisition context immediately, before any deep-link
// effect strips the query string, so signup_completed can be attributed.
captureAttribution();

if (typeof crypto.randomUUID !== 'function') {
  crypto.randomUUID = () =>
    ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, (c) =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
}

if (import.meta.env.DEV) {
  window.__exportLeads = exportLeadsCsv;
}

inject();

// Capture uncaught errors and unhandled rejections (audit P1-12).
installErrorReporting();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
        <RecoveryGate />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// Remove the static SEO/crawler fallback once the app has painted, so real
// users only see the app (crawlers that don't run JS keep the static content).
// rAF waits for the first paint so there's no blank flash between the two.
requestAnimationFrame(() => {
  document.getElementById("seo-fallback")?.remove();
});
