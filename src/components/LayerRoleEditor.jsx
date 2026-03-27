import React from "react";
import { LAYER_ROLES, ROLE_LABELS } from "../projectState";

export default function LayerRoleEditor({ layer, onChange }) {
  if (!layer) return null;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <label className="field-label">Layer Name</label>
      <input
        className="text-input"
        value={layer.name || ""}
        onChange={(e) => onChange({ name: e.target.value })}
      />

      <label className="field-label">Role</label>
      <select
        className="text-input"
        value={layer.role || "other"}
        onChange={(e) => onChange({ role: e.target.value })}
      >
        {LAYER_ROLES.map((role) => (
          <option key={role} value={role}>{ROLE_LABELS[role]}</option>
        ))}
      </select>

      <label className="field-label">Legend Label</label>
      <input
        className="text-input"
        value={layer.legendLabel || ""}
        onChange={(e) => onChange({ legendLabel: e.target.value })}
      />
    </div>
  );
}
