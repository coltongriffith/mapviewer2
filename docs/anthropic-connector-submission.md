# Anthropic Connectors Directory Submission — ExplorationMaps

Updated: 2026-09-20

## Connector type
Remote MCP server

## MCP URL
https://www.explorationmaps.com/mcp/server

## Name
ExplorationMaps

## Company
Exploration Maps

## Description
Create professional mineral exploration, mining claim, mineral tenure, investor, infrastructure and project-location maps from natural-language requests and supported public mineral registries.

## Website
https://www.explorationmaps.com

## Documentation
https://www.explorationmaps.com/mcp/

## Privacy
https://www.explorationmaps.com/privacy/

## Terms
https://www.explorationmaps.com/terms/

## Icon
https://www.explorationmaps.com/apple-touch-icon.png

## Authentication
None required for the public registry-backed tools in version 1.0.0.

## Core examples
1. Make a mining claim map for a company in British Columbia and show roads, towns and rail.
2. Search for mineral claims associated with a company or tenure number.
3. Create an investor-ready property map from public mineral-registry records.
4. Tell me which jurisdictions ExplorationMaps supports.

## Data handling
The connector queries supported public mineral registries. Map previews create expiring, unlisted public share links. The connector does not require user credentials for these public tools. Registry data is informational and is not represented as a legal title opinion or legal survey.

## Tool review
- preview_exploration_map — creates an expiring share record; non-destructive write; open-world.
- search_mineral_claims — read-only; open-world registry lookup.
- get_mapping_capabilities — read-only; closed-world/static capability data.

## Reviewer notes
The connector is intentionally narrow. It does not execute payments, transfer financial assets, generate image/video/audio media, or perform destructive actions. Map generation is deterministic from the supplied registry query and existing ExplorationMaps map templates. All tools have titles and explicit readOnly/destructive/openWorld annotations.

## Directory submission path
Claude.ai → Team/Enterprise organization → Admin settings → Directory → Submissions → New remote MCP server.
