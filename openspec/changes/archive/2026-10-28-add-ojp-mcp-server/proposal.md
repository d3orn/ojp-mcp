## Why

Colleagues want to ask an LLM about Swiss public transport (stops, trips, departures, journey details), but OJP 2.0 is verbose namespaced XML that an LLM can't call directly. A local MCP server turns it into a few well-shaped tools, with each user's API token kept out of prompts, tool output, and logs.

## What Changes

- New Node.js (plain JavaScript, ESM) MCP server, run locally over stdio via `npx ojp-mcp`.
- Talks to OJP 2.0 at `https://api.opentransportdata.swiss/ojp20` with the user's own Bearer token from `OJP_TOKEN`.
- Four tools: `search_locations`, `plan_trip`, `get_departures`, `get_trip_details`.
- `plan_trip` and `get_departures` accept stop names or IDs; ambiguous names return candidates instead of guessing.
- Responses are compact JSON (not raw XML); times are Europe/Zurich local ISO; language defaults to `de`, overridable per call.
- Token never appears in tool output, error messages, or logs; upstream auth failures map to a fixed message.

Out of scope: hosted/remote transport, client auth, rate limiting, fares, TripRefineRequest, OJP 1.0.

## Capabilities

### New Capabilities
- `server-runtime`: process startup over stdio, `OJP_TOKEN` configuration, upstream call handling, error mapping, and secret hygiene.
- `journey-tools`: the four MCP tools, their inputs, name resolution, and output shape.

### Modified Capabilities

## Impact

- New codebase (repo is greenfield): `package.json`, server entry, tool modules.
- Dependencies: `@modelcontextprotocol/sdk`, `ojp-sdk` (pending spike; fallback `fast-xml-parser` + XML templates), `zod` for tool input schemas (as the MCP SDK expects).
- External: opentransportdata.swiss OJP 2.0 API; each user needs their own token.
