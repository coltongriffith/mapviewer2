export function createInitialProjectState() {
  return {
    layers: [],
    layout: {
      title: "Project Map",
      subtitle: "Editable composition",
      basemap: "light",
      logo: null,
      legendItems: [],
      exportSettings: {
        pixelRatio: 2,
        filename: "mapviewer-export",
      },
      legendStyle: {
        background: "#ffffff",
        border: "#d9d9d9",
        text: "#1f1f1f",
        borderRadius: 10,
        padding: 12,
        width: 220,
      },
      overlays: {
        title: { visible: true, x: 24, y: 20 },
        legend: { visible: true, x: 24, y: 96 },
        northArrow: { visible: true, x: 24, y: 340 },
        scaleBar: { visible: true, x: 24, y: 410 },
        logo: { visible: true, x: 24, y: 470, width: 140 },
      },
    },
  };
}