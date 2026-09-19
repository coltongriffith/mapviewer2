# Muse Connector Submission — ExplorationMaps

Updated: 2026-09-19

## Connector name
ExplorationMaps

## One-line description
Create professional mineral exploration, mining claim, mineral tenure, drill-results, infrastructure and investor-ready project maps.

## Product description
ExplorationMaps is a mining-specific mapping service for mineral exploration companies, investors and technical teams. The connector lets Muse turn a natural-language request into a professional exploration map using supported official mineral-registry data or, for connected accounts, user-supplied drill and GeoJSON data.

Instead of exposing generic GIS commands, ExplorationMaps exposes complete mining outcomes such as claim maps, project-location maps, drill-results maps, infrastructure maps, investor-presentation figures and NI 43-101-style maps.

## Example user requests
- Make a mining claim map for [company] in British Columbia.
- Map these mineral tenure numbers and show roads and nearby towns.
- Turn these drill collar coordinates into a drill-results map.
- Create an investor-ready property map for this exploration project.
- Show this project relative to roads, rail and settlements.
- Create an NI 43-101-style map from this GeoJSON.

## How users will use it
1. User asks Muse for a mining/exploration map.
2. Muse calls ExplorationMaps.
3. ExplorationMaps searches a supported mineral registry or accepts connected-account data.
4. ExplorationMaps selects a mining-specific map type and builds the project.
5. Muse receives a shareable map URL.
6. Connected users can continue editing the same project in ExplorationMaps.

## Fast review path
Anonymous, registry-backed preview:
POST https://www.explorationmaps.com/api/agent/v1/preview

Authenticated saved map:
POST https://www.explorationmaps.com/api/agent/v1/maps

Capabilities:
GET https://www.explorationmaps.com/api/agent/v1/capabilities

OpenAPI:
https://www.explorationmaps.com/api/agent/openapi.json

Muse landing page:
https://www.explorationmaps.com/muse/

## Authentication
ExplorationMaps supports revocable bearer API keys created from the user's account. Keys are shown once, stored only as hashes, scoped, rate limited and revocable.

For Meta review, the anonymous preview endpoint allows end-to-end registry-backed testing without account provisioning. Supplied GeoJSON and drill data require a connected account.

## Data and security notes
- Anonymous previews are strictly rate limited.
- Anonymous previews cannot host arbitrary uploaded geometry.
- Connected keys are stored only as SHA-256 hashes.
- Privileged map/project database functions are service-role only.
- Map creation is idempotent for safe agent retries.
- Public share payloads have size and feature-count limits.
- Official-registry source/provenance is stored with generated claim layers.
- Known U.S. federal-claim boundary limitations are disclosed on output.
- Agent-supplied geometry is labeled as not independently verified.

## Supported map types
- Investor / presentation map
- Claims / mineral tenure map
- Drill results map
- Infrastructure / access map
- NI 43-101-style figure

## Supported registry jurisdictions
Canada:
- British Columbia
- Ontario
- Quebec
- Saskatchewan
- Manitoba
- Newfoundland & Labrador
- Yukon

United States federal BLM claim support:
- Nevada
- Arizona
- Utah
- Idaho
- Montana
- Wyoming
- Colorado
- New Mexico
- California
- Oregon
- Washington

## Suggested directory category
Business / Productivity / Mapping / Mining & Natural Resources

## Suggested featured-placement pitch
ExplorationMaps is a strong example of what an agent-native vertical service can do: a user asks for a business outcome (“make me a mining claim map”) instead of operating specialized GIS software. Muse supplies the intent and context; ExplorationMaps supplies the mining-specific data workflow and finished map.

## Support
Website: https://www.explorationmaps.com


## Review / listing assets
- Square/touch icon: https://www.explorationmaps.com/apple-touch-icon.png
- Brand logo PNG: https://www.explorationmaps.com/brand/exploration-maps-logo.png
- Brand logo SVG: https://www.explorationmaps.com/brand/exploration-maps-logo.svg
- Brand mark SVG: https://www.explorationmaps.com/brand/exploration-maps-mark.svg
- Social / preview image: https://www.explorationmaps.com/og-image.png
- Privacy policy: https://www.explorationmaps.com/privacy/
- Terms of Service: https://www.explorationmaps.com/terms/
- Billing / refunds: https://www.explorationmaps.com/refunds/
- Support: support@explorationmaps.com
- Privacy contact: privacy@explorationmaps.com

## Short form answer: “What does your connector do?”
ExplorationMaps lets Muse create professional mineral exploration maps from natural-language requests. Muse can search supported official mineral-claim registries and produce claim/tenure, investor, infrastructure and project-location maps immediately; connected ExplorationMaps accounts can also save/edit maps and map supplied drill or GeoJSON data.

## Short form answer: “How will users use it?”
A user asks Muse for a mining or exploration map in normal language—for example, “Map Example Mining’s claims in British Columbia and show roads, towns and rail.” Muse calls ExplorationMaps, which handles the registry search, mining-specific map structure and styling, and returns a shareable finished map. Connected users can open the same project in ExplorationMaps for further editing.

## Short form answer: “Why should Muse feature it?”
ExplorationMaps turns a specialist desktop-GIS workflow into a direct agent task. The user asks for the business outcome rather than operating mapping software, while the connector supplies mining-specific registry access, provenance, map templates and a finished visual artifact.
