/* ExplorationMaps · 3D Tour — data contracts
 * Input  = what the app already has for a project (claims + drill tables).
 * Output = TourPackage, the JSON injected into the viewer template.
 */

// ---------- INPUT ----------
export type Ring = [number, number][];
export interface ClaimsFC { type: 'FeatureCollection'; features: { type: 'Feature'; properties?: Record<string, unknown>; geometry: { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] } }[] }

export interface Collar {
  holeId: string;
  x: number;            // easting (or longitude if crs = EPSG:4326)
  y: number;            // northing (or latitude)
  z: number;            // collar elevation, metres ASL
  azimuth: number;      // degrees from grid north, 0–360
  dip: number;          // degrees, negative = down (e.g. -55)
  depth: number;        // total depth, metres
  year?: number;
  target?: string;      // zone / target name, e.g. "Star Main"
  provisional?: boolean;// position uncertain -> drawn lighter
}

export interface Survey { holeId: string; depth: number; azimuth: number; dip: number; }

export interface Assay {
  holeId: string;
  from: number;         // metres downhole
  to: number;
  values: Record<string, number | null>; // e.g. { Cu: 0.55, Au: 0.12 }
}

export interface TourInput {
  title: string;                       // "Star Project"
  crs: string;                         // CRS of collars, e.g. "EPSG:26909" or "EPSG:4326"
  claims: ClaimsFC;   // claim polygons in WGS84 (lon/lat), as stored in the app
  collars: Collar[];
  surveys?: Survey[];                  // optional; collar az/dip used if missing
  assays: Assay[];
  paths?: Record<string, { depth: number; x: number; y: number; z: number }[]>; // current figure's desurvey, original CRS
  grade: { field: string; unit: string; bins?: number[]; colors?: string[] }; // field "Cu", unit "%"
  footprintThreshold?: number;         // default = bins[1]
  footprintEnabled?: boolean;          // explicit opt-in; generalized illustration only
  mainTarget?: string;                 // default = target with most holes, else densest cluster
  labels?: { text: string; holeId?: string; lon?: number; lat?: number; views?: number[]; below?: boolean }[];
  tabs?: [string, string][];           // 3 view tabs [title, subtitle]
  claimsLegend?: string;               // "Star Copper claims"
  imageryUrl?: string;                 // XYZ template {z}/{x}/{y}; default Esri World Imagery
}

// ---------- OUTPUT (matches viewer template v1) ----------
// Local frame: x = E - origin.E, y = elev - origin.Z, z = -(N - origin.N)  (metres, equal scale)
export interface TourPackage {
  v: 1;
  holes: { n: string; yr?: number; pv: boolean; sm: boolean; p: number[] }[]; // p = flat [x,y,z,...]
  runs: [number, number[], number][];      // [holeIndex, flat path, binIndex]
  claims: number[][];                      // rings, flat [x,z,...]
  fpoly: number[][];                       // footprint rings, flat [x,z,...]
  collars: [number, number, number, number][]; // [x,y,z, inMainTarget 0|1]
  terrain: {
    utm: [number, number, number, number]; // local extent [x0,z0,x1,z1]
    corners: [number, number][];           // lon/lat of SW, SE, NW, NE (bilinear)
    step: number; demZoom: number; imgZoom: number; detailZoom: number; detailR: number;
  };
  config: {
    title: string; tag: string;
    tabs: [string, string][];
    legend: { claims: string; holes: string; grade: string };
    bins: [string, string][];              // [label, colour]
    labels: { t: string; x?: number; z?: number; fp?: boolean; views: number[]; below?: boolean }[];
    imagery?: string;
  };
  meta: { origin: [number, number, number]; crs: string; holes: number; built: string; warnings: string[] };
}
