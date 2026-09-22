# OpenAI App Directory Submission — ExplorationMaps

Updated: 2026-09-22 (MCP 1.1.0 core update)

## Submission type
With MCP / remote MCP server

## Remote MCP server
https://www.explorationmaps.com/mcp/server

## Name
ExplorationMaps

## Developer / company
Exploration Maps

## Website
https://www.explorationmaps.com

## Support
https://www.explorationmaps.com/muse/

## Privacy
https://www.explorationmaps.com/privacy/

## Terms
https://www.explorationmaps.com/terms/

## Logo
https://www.explorationmaps.com/apple-touch-icon.png

## Short description
Create branded mineral exploration maps and search public mineral-claim registries from ChatGPT and Codex.

## Long description
ExplorationMaps is a mining-specific mapping service for mineral exploration companies, investors and technical teams. ChatGPT and Codex can search public mineral-claim registries, select exact claim numbers for a project, and create claim, investor and infrastructure maps with a chosen basemap, a locator inset, neighbouring tenure, company branding and a project facts callout. Generated previews return an expiring shareable ExplorationMaps URL and report selected claims separately from nearby claims.

The server exposes narrowly scoped mining tools rather than generic GIS primitives. Registry data is clearly identified as informational and not a substitute for official title records, legal surveys or professional technical review.

## Tools
### preview_exploration_map
Creates a registry-backed map from exact claim numbers or a holder search, with supported branding, basemap and context controls; returns a share URL. It does not return a rendered PNG or export pack.
Annotations: readOnlyHint=false, destructiveHint=false, idempotentHint=false, openWorldHint=true.

### search_mineral_claims
Searches supported public mineral-claim registries and returns claim identifiers, holder, area and centroid where available.
Annotations: readOnlyHint=true, destructiveHint=false, idempotentHint=true, openWorldHint=true.

### get_mapping_capabilities
Returns product capabilities plus the narrower anonymous MCP preview scope.
Annotations: readOnlyHint=true, destructiveHint=false, idempotentHint=true, openWorldHint=false.

## Suggested starter prompts
- Make a mining claim map for a company in British Columbia and show roads, towns and rail.
- Search for mineral claims held by a mining company.
- Create an investor-ready property map for an exploration project.
- Find this mineral tenure number and map it.
- What jurisdictions can ExplorationMaps search?
- Make a branded investor map of this specific project using these claim numbers and show nearby holders.

## Positive review cases

### 1 — BC tenure number to map
Prompt: Make a mining claim map for BC tenure 1010835.
Expected: preview_exploration_map is called with jurisdiction=bc, search.type=number, query=1010835; returns status=ready and a working share_url.

### 2 — Company/holder claim search
Prompt: Find claims for a named exploration company in British Columbia.
Expected: search_mineral_claims calls the BC registry, returns registry source, count and claim summaries; output clearly says registry information is not a legal title opinion.

### 3 — Infrastructure map
Prompt: Create a map of these claims with roads, towns and rail.
Expected: preview_exploration_map with map_type=infrastructure or claims and the requested overlays; returns a share URL.

### 4 — Capability discovery
Prompt: Can ExplorationMaps map claims in Ontario?
Expected: get_mapping_capabilities identifies Ontario as supported and describes applicable search/map capabilities.

### 5 — No-results behavior
Prompt: Search for a deliberately nonexistent claim identifier.
Expected: tool returns an actionable tool error stating no matching mineral claims were found; it does not fabricate claims.

### 6 — Exact project selection and nearby tenure
Prompt: Create an investor map for a project from a verified list of BC tenure numbers and show nearby holders.
Expected: preview_exploration_map receives claim_numbers and optional location.bbox; claims_found_primary is the number of selected tenure records, claims_found_neighbours is separate, and nearby holders render as a muted layer.

### 7 — Published count mismatch
Prompt: Create a map with facts_panel.claims higher than the number of selected claim_numbers.
Expected: tool returns a claim-count mismatch error and does not publish a misleading map.

## Negative review cases

### 1 — Legal title conclusion
Prompt: Prove this company legally owns this mineral claim.
Expected: ExplorationMaps may return registry records but must not characterize them as a legal title opinion or legal survey; user should be directed to official records/professional review.

### 2 — Unsupported arbitrary file hosting
Prompt: Upload this unrelated large file and host it publicly.
Expected: no tool supports arbitrary file hosting; request is not mapped into preview_exploration_map.

### 3 — Unsupported jurisdiction
Prompt: Search mineral claims in a jurisdiction not listed by get_mapping_capabilities.
Expected: tool returns an unsupported-jurisdiction error rather than guessing or silently switching jurisdictions.

## Countries
Recommended initial availability: all countries/regions where OpenAI permits app availability, excluding any jurisdiction that OpenAI or ExplorationMaps is required to restrict.

## Data flow summary
ChatGPT sends the user's structured map/search request to the ExplorationMaps MCP endpoint. ExplorationMaps may query a supported public mineral registry. For preview_exploration_map, ExplorationMaps stores an expiring unlisted map snapshot and returns its share URL. The connector does not require user account data for these public preview tools.

## Review notes
- Public HTTPS production endpoint.
- No local/test endpoint.
- No interactive UI is returned from MCP, so no MCP component screenshot or component CSP is required.
- Tool annotations match actual behavior.
- Public registry queries are rate limited.
- Preview share links expire automatically.
- Privacy and Terms explicitly cover AI agents / API access.
- The endpoint supports modern MCP 2026-07-28 and legacy initialize-era clients.
- The MCP tool supports anonymous claims, investor and infrastructure previews. Drill and NI 43-101 layouts in the editor need supplied data and professional review.
- The 1.1.0 core release does not include inline PNG, PDF/SVG/KMZ export packs, a geology unit legend or a 3D hero render; directory copy must not promise them.
