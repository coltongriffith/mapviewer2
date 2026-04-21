import shp from "shpjs";

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50 MB

export async function loadGeoJSON(file) {
  if (!file) {
    throw new Error("No file provided.");
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Maximum is 50 MB.`);
  }

  const name = file.name.toLowerCase();

  if (name.endsWith(".zip")) {
    const buffer = await file.arrayBuffer();
    const result = await shp(buffer);

    if (Array.isArray(result)) {
      const mergedFeatures = result.flatMap((item) => {
        if (item?.type === "FeatureCollection") return item.features || [];
        if (item?.type === "Feature") return [item];
        return [];
      });

      return {
        type: "FeatureCollection",
        features: mergedFeatures,
      };
    }

    if (result?.type === "FeatureCollection" || result?.type === "Feature") {
      return result;
    }

    throw new Error("ZIP imported, but no valid shapefile data was found.");
  }

  if (name.endsWith(".geojson") || name.endsWith(".json")) {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data || typeof data !== "object") {
      throw new Error("Invalid GeoJSON file.");
    }

    return data;
  }

  throw new Error("Unsupported file type. Use .zip, .geojson, or .json");
}
