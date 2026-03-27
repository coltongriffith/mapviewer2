import React from "react";

export default function Sidebar({ children }) {
  return (
    <aside
      style={{
        width: 280,
        background: "#111",
        color: "#fff",
        padding: 12,
        overflowY: "auto",
        borderRight: "1px solid #2b3341",
      }}
    >
      {children}
    </aside>
  );
}
