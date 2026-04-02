import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./styles.css";
import "leaflet/dist/leaflet.css";

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: 0.1,
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<div style={{ padding: 32, fontFamily: 'sans-serif' }}>Something went wrong. Please reload the page.</div>}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
