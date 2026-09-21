# Gemini Remote MCP — ExplorationMaps

Updated: 2026-09-20

ExplorationMaps exposes a public Streamable HTTP MCP server:

https://www.explorationmaps.com/mcp

## Interactions API example (JavaScript)

```js
import { GoogleGenAI } from '@google/genai';

const client = new GoogleGenAI({});

const interaction = await client.interactions.create({
  model: 'gemini-3.8-flash',
  input: 'Make a mining claim map for BC tenure 1010835.',
  tools: [{
    type: 'mcp_server',
    name: 'explorationmaps',
    url: 'https://www.explorationmaps.com/mcp'
  }]
});

console.log(interaction.output_text);
```

No authentication headers are required for the public registry-backed tools.

## Supported public tools
- preview_exploration_map
- search_mineral_claims
- get_mapping_capabilities

## Notes
Gemini's Remote MCP support uses Streamable HTTP. ExplorationMaps uses a lowercase alphanumeric server name compatible with Gemini MCP naming requirements when configured by clients: explorationmaps.
