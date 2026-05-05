import React from "react";

export default function Sidebar({ children, footer }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">{children}</div>
      {footer && <div className="sidebar-footer">{footer}</div>}
    </aside>
  );
}
