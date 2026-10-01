# Anthropic Connectors Directory Submission — ExplorationMaps

Updated: 2026-09-22 (MCP 1.1.0 core update)

## Connector type
Remote MCP server

## MCP URL
https://www.explorationmaps.com/mcp/server

## Name
ExplorationMaps

## Company
Exploration Maps

## Description
Search public mineral-claim registries and create branded project, investor and infrastructure maps with exact claim selection, nearby tenure, a locator inset and a shareable preview.

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
None required at https://www.explorationmaps.com/mcp/server. The same tools are also served at https://www.explorationmaps.com/mcp/account behind OAuth 2.1 sign-in: Supabase Auth is the authorization server (dynamic client registration, PKCE), discovered from the protected resource metadata at /.well-known/oauth-protected-resource/mcp/account, with consent at https://explorationmaps.com/oauth/consent.

## Usage limits
Free, anonymous use allows 10 map previews per hour (rolling) and 30 claim searches per hour. Each preview returns `allowance` with the number remaining; a capped call returns `RATE_LIMITED` with `resets_at`, `retry_after_seconds` and the editor URL. A shared ceiling of 300 previews per hour per network also applies. Signed in through /mcp/account: 30 previews and 90 searches per hour on the Free plan, 200 previews and 600 searches on Pro, with previews saved to the account.

## Core examples
1. Make a mining claim map for a company in British Columbia and show roads, towns and rail.
2. Search for mineral claims associated with a company or tenure number.
3. Create an investor-ready property map from public mineral-registry records.
4. Tell me which jurisdictions ExplorationMaps supports.
5. Map these exact BC tenure numbers, show nearby holders, and use the company's website branding.

## Data handling
The connector queries supported public mineral registries. Map previews create expiring, unlisted public share links. The connector does not require user credentials for these public tools. Registry data is informational and is not represented as a legal title opinion or legal survey.

## Tool review
- preview_exploration_map — creates an expiring share record; non-destructive write; open-world.
- search_mineral_claims — read-only; open-world registry lookup.
- get_mapping_capabilities — read-only; closed-world/static capability data.

## Reviewer notes
The connector is intentionally narrow. It does not execute payments, transfer financial assets, generate image/video/audio media, or perform destructive actions. Map generation uses a public registry query and existing ExplorationMaps map templates. Exact claim selection avoids pulling unrelated projects into one map. Nearby claims are counted separately. The MCP preview returns a share URL, not an inline image or export pack. All tools have titles and explicit readOnly/destructive/openWorld annotations.

## Directory submission path
Claude.ai → Team/Enterprise organization → Admin settings → Directory → Submissions → New remote MCP server.
