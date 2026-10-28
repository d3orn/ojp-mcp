## 1. Scaffold and spike

- [x] 1.1 Create `package.json` (ESM, Node ≥ 20, `bin: ojp-mcp`, `test: node --test`), add `@modelcontextprotocol/sdk` and `zod`
- [x] 1.2 Spike `ojp-sdk` (30 min box): import in plain Node ESM, build LIR/TR/SER/TIR for OJP 2.0, check parsed fields (estimated times, platforms, situations, journeyRef), check HTTP errors can be intercepted. Record go/no-go in design.md
- [x] 1.3 Capture one real response per request type (LIR, TR, SER, TIR, plus a 401) as test fixtures, with the token removed

## 2. Upstream access and secret hygiene

- [x] 2.1 Startup check: exit non-zero with stderr message if `OJP_TOKEN` is missing
- [x] 2.2 Single upstream function `ojpRequest(kind, params)`: Bearer header, 15 s timeout, 401/403 → fixed message, other failures → status + short reason only, OJP error conditions surfaced (via ojp-sdk or XML templates + `fast-xml-parser` per spike outcome)
- [x] 2.3 Final redaction of the token value from any tool error text
- [x] 2.4 Test: 401, network failure, and timeout paths produce the specified messages and never contain the token string

## 3. Shared helpers

- [x] 3.1 Time helpers: naive input → Europe/Zurich → UTC for requests; output formatting as Zurich ISO with offset (`Intl`, no date lib)
- [x] 3.2 Name-or-ID resolver: ID passthrough, LIR lookup, clear-match rule, ambiguous/unknown errors with up to 5 candidates
- [x] 3.3 Tests for time conversion (incl. DST boundary) and resolver (ID, unique, exact-name-wins, ambiguous, none)

## 4. Tools

- [x] 4.1 `search_locations` (name or lat/lon/radius, types, limit) with slim mapping
- [x] 4.2 `plan_trip` (from/to/via, time, arriveBy, limit) with trip/leg mapping incl. situations, cancellations, journeyRef/operatingDay
- [x] 4.3 `get_departures` (stop, time, type, limit) with event mapping
- [x] 4.4 `get_trip_details` (journeyRef, operatingDay) with call-list mapping and not-found error
- [x] 4.5 `language` param on all tools, default `de`
- [x] 4.6 Mapping tests per tool against the recorded fixtures

## 5. Wire-up and docs

- [x] 5.1 Server entry: `McpServer` + `StdioServerTransport`, register the four tools with descriptions written for LLMs
- [x] 5.2 Manual end-to-end check with a real token via `claude mcp add ojp -e OJP_TOKEN=… -- node ./bin` (list tools, run each once)
- [x] 5.3 README: getting a token, `claude mcp add` / Claude Desktop config with `env`, tool list
- [x] 5.4 Update CLAUDE.md with the real install/test commands
