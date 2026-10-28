# server-runtime Specification

## Purpose

Runs the OJP MCP server locally over stdio against the OJP 2.0 backend, using the user's own API token while guaranteeing that token never leaves the process.

## Requirements

### Requirement: Stdio MCP server
The system SHALL run as an MCP server over stdio, launchable as a single command without a global install, and SHALL expose exactly the tools defined in the `journey-tools` capability.

#### Scenario: Client lists tools
- **WHEN** an MCP client connects over stdio and lists tools
- **THEN** the server returns `search_locations`, `plan_trip`, `get_departures`, and `get_trip_details`, each with a description and input schema

### Requirement: Token from environment
The system SHALL read the OJP API token only from the `OJP_TOKEN` environment variable and SHALL send it as a Bearer token to `https://api.opentransportdata.swiss/ojp20`.

#### Scenario: Token missing at startup
- **WHEN** the server starts and `OJP_TOKEN` is unset or empty
- **THEN** the process exits with a non-zero code and a message on stderr naming `OJP_TOKEN` as missing

#### Scenario: Token present
- **WHEN** a tool is called and `OJP_TOKEN` is set
- **THEN** the upstream request carries `Authorization: Bearer <token>`

### Requirement: Token never exposed
The system MUST NOT include the token, the `Authorization` header, or raw upstream request configuration in any tool result, error message, or log output.

#### Scenario: Upstream rejects token
- **WHEN** the upstream API responds with HTTP 401 or 403
- **THEN** the tool returns an error with the fixed message "OJP_TOKEN is invalid or not authorized for OJP 2.0" and no request details

#### Scenario: Network or unexpected upstream failure
- **WHEN** the upstream call fails with a network error, timeout, or non-2xx status other than 401/403
- **THEN** the tool returns an error containing at most the HTTP status and a short reason, and the error text does not contain the token value

#### Scenario: Upstream maintenance page
- **WHEN** the upstream answers HTTP 500 with an HTML "ODMCH OJP Service Unavailable" page
- **THEN** the tool returns `OJP service error: HTTP 500` and does not include the HTML body

### Requirement: Safe XML handling
Every value inserted into a request body SHALL be XML-escaped, with characters illegal in XML 1.0 removed. The response parser SHALL refuse DTD-declared entities while still decoding the predefined XML entities.

#### Scenario: Control characters in input
- **WHEN** a place name contains U+0000 or another XML-illegal character
- **THEN** that character is removed and the request remains well-formed XML

#### Scenario: Response declares an entity
- **WHEN** the upstream response contains a DTD declaring a custom entity
- **THEN** the tool returns an error instead of expanding it

### Requirement: Upstream timeout
The system SHALL abort an upstream request that does not complete within 15 seconds and report it as a tool error.

#### Scenario: Slow upstream
- **WHEN** the upstream API does not respond within 15 seconds
- **THEN** the tool returns an error stating the OJP service timed out

### Requirement: OJP-level errors surfaced
The system SHALL report OJP error conditions returned inside a successful HTTP response (e.g. no results, invalid location) as a tool error or empty result with the OJP error code/text, not as a crash.

#### Scenario: No trip found
- **WHEN** the upstream returns a trip response with an error condition and no trip results
- **THEN** the tool returns an error describing the condition (e.g. "no trips found")
