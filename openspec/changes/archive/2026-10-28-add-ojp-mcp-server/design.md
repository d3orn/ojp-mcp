## Context

Greenfield repo. Backend is opentransportdata.swiss OJP 2.0 (`/ojp20`, Bearer JWT, XML POST). Request shapes are documented by example in `openTdataCH/api-explorer` → `public/openapi/ojp2.0/openapi.template.yaml`. The same org publishes a JS/TS SDK, `ojp-sdk` (repo `openTdataCH/ojp-js`, 0.23.4, axios + fast-xml-parser), whose README is inconsistent (imports `ojp-sdk-next`, typos) and doesn't state Node support. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- Smallest code that gives an LLM good journey answers: four tools, slim JSON.
- Secret hygiene enforced at one choke point, not per tool.

**Non-Goals:**
- TypeScript build step, bundling, or a generic OJP client library.
- Caching, retries, or response pagination.
- HTTP/SSE transport (adding it later is a transport swap in the MCP SDK).

## Decisions

**Plain JS, ESM, Node ≥ 20, published to npm with a `bin` entry.** Users run `npx ojp-mcp`. No build step. Alternative TS was rejected per user choice; JSDoc types only where they clarify.

**`@modelcontextprotocol/sdk` `McpServer` + `StdioServerTransport`, zod input schemas.** It's the reference SDK and validates inputs for us.

**OJP access: `ojp-sdk` if the spike passes, else hand-written templates.** Spike (task 1) checks: imports in plain Node ESM, can build LIR/TR/SER/TIR for 2.0, parsed objects carry the fields the spec needs (estimated times, platforms, situations, journeyRef), and errors can be intercepted. Fallback: four XML string templates modelled on the api-explorer examples (values XML-escaped) + `fast-xml-parser` with `removeNSPrefix`. The fallback is ~100 lines and has no unknowns, so the spike is time-boxed to 30 minutes; any blocker → fallback. Both paths sit behind one module exposing `ojpRequest(kind, params) → parsed object`, so tools don't care which won.

**Single upstream choke point.** All HTTP goes through one function that: sets Bearer header from `process.env.OJP_TOKEN`, applies a 15 s `AbortSignal.timeout`, maps 401/403 to the fixed message, and rethrows every other failure as a new `Error` built only from status + short reason. The original error object (axios errors carry `config.headers`) is never passed to MCP output or `console`. If using `ojp-sdk`, its HTTP call is wrapped (or replaced by our own `fetch` feeding its parser) so this choke point still applies. Final guard: before returning any tool error text, replace occurrences of the token value with `***`.

**Name resolution in one helper.** Input matching an ID pattern (`ch:1:sloid:…`, `ch:1:…`, all-digits, or a type-prefixed `address:`/`poi:`/`topographicPlace:` ID) passes through and is sent with the matching OJP 2.0 ref element. Otherwise run LIR with `NumberOfResults=5`, type `stop` (plus `address`/`poi` for `plan_trip`). "Clear match": exactly one result, or the first result's name equals the input case- and diacritics-insensitively while no other result does. Else return candidates. Alternative "always take top hit" rejected: silent wrong trips are worse than one extra LLM turn.

**Times.** Use `Intl.DateTimeFormat` with `timeZone: 'Europe/Zurich'` to compute the offset for naive inputs and to format outputs; no date library. OJP accepts UTC ISO, so inputs are converted to UTC for the request.

**Output mapping is per tool, hand-written.** Only fields in the spec are emitted; absent fields are omitted, not null. This is where most of the code lives.

**Spike result (2026-10-28): no-go on `ojp-sdk` 0.23.4 → fallback.** It imports fine in Node ESM, but: on any parse failure it does `console.log(responseXML)` to stdout, which corrupts the stdio MCP channel; axios is called with no timeout and its raw errors (carrying `config.headers` incl. `Authorization`) propagate uncaught; and the parsed `value` is just the raw fast-xml-parser tree, so it saves no mapping work. Using `fetch` + XML templates + `fast-xml-parser` (`removeNSPrefix`).

**Live check (2026-10-28).** Fixtures: LIR/TR/SER are real OJP 2.0 responses from `ojp-js/tests/ojp-fixtures`; TIR and the 401 were captured live. Findings: the backend ignores `NumberOfResults` on LIR, so results are sliced client-side; stop IDs sent as `siri:StopPointRef` work for both SLOIDs and numeric refs; TIR without `Params` returns calls. The gateway intermittently answers HTTP 500 with an HTML "Service Unavailable" page (also for malformed `JourneyRef`s), which surfaces as `OJP service error: HTTP 500` (no retries, per non-goals). About 4 of the first 12 live calls hit this, and the same calls succeeded on rerun seconds later.

**Upstream quota (per token, from the API manager):** 20 000 calls/day, 50 calls/minute. Call cost per tool: `search_locations` 1, `get_departures` 1–2, `get_trip_details` 1, `plan_trip` 1 plus 1 per name-resolved place (up to 4 with `from`/`to`/`via` names, sent in parallel). So ~12 name-based trip plans per minute exhaust the minute limit. The observed 500s are probably not this limit: each live run made ~13 calls, well under 50/min, and a rate-limit response would normally be HTTP 429. A burst (per-second) limit is not ruled out. Unverified: the exact status/body the gateway returns when the limit is hit; it currently surfaces as `OJP service error: HTTP <status>`.

## Risks / Trade-offs

- [ojp-sdk breaks in Node or hides HTTP errors] → time-boxed spike, fallback path decided up front.
- [Token leak via an unanticipated error path] → single choke point + final token-redaction pass on error text + a test that triggers 401 and network failure and asserts the token string is absent from output.
- [OJP 2.0 response quirks (missing estimated times, multiple Text languages)] → mapping tolerates absence; tests use recorded real responses as fixtures.
- [Name resolution heuristic picks wrong stop] → conservative rule; ambiguity returns candidates.
- [Upstream rate limits per token: 50/min, 20 000/day] → per-user tokens; enough for one person in a chat. Name-based `plan_trip` costs up to 4 calls, so an LLM looping over many trips can hit the minute limit; passing ids from `search_locations` costs 1.

## Open Questions

- Exact npm package name availability (`ojp-mcp`); choose a scoped name if taken.
