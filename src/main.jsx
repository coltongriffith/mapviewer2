import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "leaflet/dist/leaflet.css";
import { exportLeadsCsv } from "./utils/leadCapture";
import ErrorBoundary from "./components/ErrorBoundary";

if (typeof crypto.randomUUID !== 'function') {
  crypto.randomUUID = () =>
    ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, (c) =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
}

if (import.meta.env.DEV) {
  window.__exportLeads = exportLeadsCsv;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
