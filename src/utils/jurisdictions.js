// Claim-search jurisdictions: Canadian provinces/territories + U.S. federal
// (BLM MLRS) states. Single source of truth shared by RegistrySearch, the
// nearby-claims panel, and marketing copy. The server-side counterpart lives
// in api/claims.js (US_JURISDICTIONS) — keep the state list in sync.

// Feature flag: U.S. jurisdictions ship dark until enabled.
export const US_CLAIMS_ENABLED = import.meta.env.VITE_ENABLE_US_CLAIMS === '1';

export const US_STATES = [
  { value: 'us-nv', label: 'Nevada' },
  { value: 'us-az', label: 'Arizona' },
  { value: 'us-ut', label: 'Utah' },
  { value: 'us-id', label: 'Idaho' },
  { value: 'us-mt', label: 'Montana' },
  { value: 'us-wy', label: 'Wyoming' },
  { value: 'us-co', label: 'Colorado' },
  { value: 'us-nm', label: 'New Mexico' },
  { value: 'us-ca', label: 'California' },
  { value: 'us-or', label: 'Oregon' },
  { value: 'us-wa', label: 'Washington' },
];

export const US_GROUP_LABEL = 'United States — federal claims (BLM)';

// The exact user-facing geometry disclaimer (spec wording — do not reword).
export const US_GEOMETRY_DISCLAIMER =
  'U.S. mining-claim boundaries shown by Exploration Maps are generalized representations derived from public BLM records. They are not legal surveys and should not be relied upon to determine exact claim boundaries or ownership.';

// Marketing copy string reused verbatim on the homepage, blog, and emails.
export const US_COVERAGE_COPY =
  'Now including U.S. federal mining claims (BLM MLRS) for Nevada, Arizona, Utah, Idaho, Montana, Wyoming, Colorado, New Mexico, California, Oregon and Washington. U.S. coverage is federal claims only — state-managed tenure (including Alaska state claims) is not yet included.';

// Normalized U.S. claim types (mirrors normalizeUsClaimType in api/claims.js).
export const US_CLAIM_TYPES = [
  { value: 'lode', label: 'Lode' },
  { value: 'placer', label: 'Placer' },
  { value: 'mill_site', label: 'Mill site' },
  { value: 'tunnel_site', label: 'Tunnel site' },
];

export const isUsJurisdiction = (value) => typeof value === 'string' && value.startsWith('us-');
