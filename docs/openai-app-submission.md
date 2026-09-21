# OpenAI App Directory Submission — ExplorationMaps

Updated: 2026-09-20

## Submission type
With MCP / remote MCP server

## Remote MCP server
https://www.explorationmaps.com/mcp

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
Create professional mineral exploration maps and search public mineral-claim registries directly from ChatGPT and Codex.

## Long description
ExplorationMaps is a mining-specific mapping service for mineral exploration companies, investors and technical teams. The app lets ChatGPT and Codex search supported official mineral-claim registries and turn natural-language requests into professional claim/tenure, investor-presentation, project-location and infrastructure maps. Generated previews return a shareable ExplorationMaps URL.

The server exposes narrowly scoped mining tools rather than generic GIS primitives. Registry data is clearly identified as informational and not a substitute for official title records, legal surveys or professional technical review.

## Tools
### preview_exploration_map
Creates a professional registry-backed exploration map and returns a share URL.
Annotations: readOnlyHint=false, destructiveHint=false, idempotentHint=false, openWorldHint=true.

### search_mineral_claims
Searches supported official mineral-claim registries.
Annotations: readOnlyHint=true, destructiveHint=false, idempotentHint=true, openWorldHint=true.

### get_mapping_capabilities
Returns supported map types, jurisdictions, overlays, search modes and styles.
Annotations: readOnlyHint=true, destructiveHint=false, idempotentHint=true, openWorldHint=false.

## Suggested starter prompts
- Make a mining claim map for a company in British Columbia and show roads, towns and rail.
- Search for mineral claims held by a mining company.
- Create an investor-ready property map for an exploration project.
- Find this mineral tenure number and map it.
- What jurisdictions can ExplorationMaps search?

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
