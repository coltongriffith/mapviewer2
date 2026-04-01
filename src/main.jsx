import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "leaflet/dist/leaflet.css";
import { exportLeadsCsv } from "./utils/leadCapture";

// Developer-only utility — not linked anywhere in the UI.
// Access via browser DevTools console: __exportLeads()
window.__exportLeads = exportLeadsCsv;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
