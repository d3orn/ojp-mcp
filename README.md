# ojp-mcp

MCP server for Swiss public transport, backed by the [OJP 2.0](https://opentransportdata.swiss/en/cookbook/open-journey-planner-ojp/) API of opentransportdata.swiss. Runs locally over stdio with your own API token.

> **Proof of concept.** This project is not actively maintained. Feel free to reuse and fork it under the [MIT license](LICENSE).

## Token

1. Register at <https://api-manager.opentransportdata.swiss>.
2. Subscribe to the **OJP 2.0** API and copy your token.
3. Pass it as `OJP_TOKEN` (environment only; it never appears in tool output or logs).

## Setup

Requires Node ≥ 20.

```sh
git clone https://github.com/d3orn/ojp-mcp.git
cd ojp-mcp
npm install
```

Claude Code:

```sh
claude mcp add ojp -e OJP_TOKEN=<your-token> -- node /absolute/path/to/ojp-mcp/src/index.js
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ojp": {
      "command": "node",
      "args": ["/absolute/path/to/ojp-mcp/src/index.js"],
      "env": { "OJP_TOKEN": "<your-token>" }
    }
  }
}
```

Not yet published to npm. Once it is, `npx -y ojp-mcp` replaces `node /absolute/path/to/ojp-mcp/src/index.js`.

## Tools

| Tool | Purpose |
|------|---------|
| `search_locations` | Stops, addresses, POIs, towns by `name` or `lat`/`lon` (+ `radius`) |
| `plan_trip` | Trips `from` → `to` (optional `via`), `time`, `arriveBy`, `limit` |
| `get_departures` | Departure/arrival board for a `stop` |
| `get_trip_details` | All calls of one journey (`journeyRef` + `operatingDay` from the tools above) |

Places accept a name or an id from `search_locations`; ambiguous names return candidate ids instead of guessing. Times are Europe/Zurich (input without offset is local time). All tools take `language` (`de` default, `fr`, `it`, `en`).

## Limits & errors

The OJP API allows **50 calls per minute** and **20 000 calls per day** per token. Most tools use 1 call. `plan_trip` uses 1 more for each place given as a name, so up to 4. Pass ids from `search_locations` to save calls.

| Error | Meaning |
|-------|---------|
| `OJP_TOKEN is invalid or not authorized for OJP 2.0` | Token wrong, expired, or not subscribed to OJP 2.0 |
| `OJP service error: HTTP 500` | Upstream temporarily unavailable. Retry shortly |
| `OJP service error: HTTP 429` (or other status) | Rate limit or other upstream rejection. Wait and retry |
| `OJP service timed out` | No answer within 15 s |
| `… is ambiguous … Use one of these ids` | Retry with one of the listed ids |

## Development

```sh
npm install
npm test
```

## License

[MIT](LICENSE)
