import React from "react";
import Legend from "./Legend";
import NorthArrow from "./NorthArrow";
import ScaleBar from "./ScaleBar";
import InsetMap from "./InsetMap";
import CalloutLayer from "./CalloutLayer";

function zoneStyle(zone) {
  return {
    position: "absolute",
    top: zone.top,
    left: zone.left,
    right: zone.right,
    bottom: zone.bottom,
    width: zone.width,
    height: zone.height,
    transform: zone.transform,
    zIndex: 500,
  };
}

export default function TemplateRenderer({ project, template, map, legendItems, onNudgeCallout }) {
  return (
    <div className="template-overlay-root">
      <div className="template-panel title-block" style={zoneStyle(template.zones.title)}>
        <div className="map-title">{project.layout.title}</div>
        <div className="map-subtitle">{project.layout.subtitle}</div>
      </div>

      <div style={zoneStyle(template.zones.northArrow)}>
        <NorthArrow />
      </div>

      <div style={zoneStyle(template.zones.legend)}>
        <Legend items={legendItems} />
      </div>

      <div style={zoneStyle(template.zones.scaleBar)}>
        <ScaleBar map={map} />
      </div>

      {project.layout.insetEnabled && (
        <div style={zoneStyle(template.zones.inset)} className="template-panel inset-wrap">
          <InsetMap mainMap={map} basemap={project.layout.basemap} />
        </div>
      )}

      {project.layout.logo && (
        <div style={zoneStyle(template.zones.logo)} className="template-panel logo-wrap">
          <img src={project.layout.logo} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        </div>
      )}

      <CalloutLayer callouts={project.annotations.callouts} template={template} onNudge={onNudgeCallout} />
    </div>
  );
}
