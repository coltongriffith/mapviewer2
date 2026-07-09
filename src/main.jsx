import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "leaflet/dist/leaflet.css";
import { exportLeadsCsv } from "./utils/leadCapture";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider } from "./hooks/useAuth.jsx";
import { captureAttribution } from "./utils/attribution";
import { inject } from "@vercel/analytics";

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

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
