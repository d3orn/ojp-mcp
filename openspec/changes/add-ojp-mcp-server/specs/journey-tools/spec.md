## Purpose

Exposes the common OJP 2.0 journey-planning operations as four MCP tools with LLM-friendly inputs (names or IDs) and compact JSON outputs.

## ADDED Requirements

### Requirement: Shared conventions
All tools SHALL return compact JSON (never raw OJP XML). All times in inputs and outputs SHALL be ISO 8601 in Europe/Zurich local time with offset. Inputs without an offset SHALL be interpreted as Europe/Zurich. Every tool SHALL accept an optional `language` (`de`, `fr`, `it`, `en`), defaulting to `de`. A `limit` SHALL cap the number of returned results even when the upstream returns more than requested. Free-text inputs SHALL be length-capped: place names, IDs, and `journeyRef` at 200 characters, `time` at 40. A single unparseable time in an upstream response SHALL leave that field empty rather than fail the call.

#### Scenario: Upstream ignores the requested count
- **WHEN** `search_locations` is called with `limit: 5` and the upstream returns 6 locations
- **THEN** only the first 5 are returned

#### Scenario: Local time without offset
- **WHEN** a tool receives `time: "2026-11-02T08:00"` or `"2026-11-02T08:00:00.000"`
- **THEN** it is treated as 08:00 Europe/Zurich

#### Scenario: Oversized input
- **WHEN** a tool receives a place name longer than 200 characters
- **THEN** it returns an input error and makes no upstream call

#### Scenario: Malformed upstream time
- **WHEN** an upstream event carries an unparseable `EstimatedTime`
- **THEN** that event's `estimated` is omitted and the other results are returned

#### Scenario: Output times
- **WHEN** a tool returns a departure time
- **THEN** it is formatted like `2026-11-02T08:04:00+01:00`

#### Scenario: Language override
- **WHEN** a tool is called with `language: "fr"`
- **THEN** place and stop names in the result are requested in French

### Requirement: search_locations
The system SHALL provide `search_locations` taking either a `name` or a `lat`/`lon` with optional `radius` (meters, default 1000), an optional `types` filter (`stop`, `address`, `poi`, `topographicPlace`), and optional `limit` (default 5, max 20). Each result SHALL include `id`, `name`, `type`, `lat`, `lon`, and for stops the served `modes` when available. Stop IDs SHALL be the upstream stop reference unchanged; other IDs SHALL be prefixed with their type (`address:…`, `poi:…`, `topographicPlace:…`).

#### Scenario: Search by name
- **WHEN** called with `name: "Bern"`
- **THEN** it returns up to 5 locations, the stop "Bern" among them with an `id` usable by the other tools

#### Scenario: Search by coordinates
- **WHEN** called with `lat: 47.3766, lon: 8.5389, types: ["stop"]`
- **THEN** it returns stops within 1000 m of that point

#### Scenario: Neither name nor coordinates
- **WHEN** called with no `name` and no `lat`/`lon`
- **THEN** it returns an input error

### Requirement: Name-or-ID place resolution
Wherever `plan_trip` and `get_departures` take a place, the input SHALL accept either a location ID (as returned by `search_locations`) or a free-text name. A name SHALL be resolved via location search: if one result clearly matches, it is used; otherwise the tool SHALL NOT guess and SHALL return an error listing up to 5 candidates (`id`, `name`, `type`). Every candidate ID SHALL be accepted as input. A place SHALL be sent upstream with the reference element matching its type (`siri:StopPointRef`, `AddressRef`, `PointOfInterestRef`, `TopographicPlaceRef`), falling back to its coordinates when it has no ID. A matched place with neither ID nor coordinates SHALL be an error.

#### Scenario: ID passed through
- **WHEN** `plan_trip` is called with `from: "ch:1:sloid:7000"`
- **THEN** no location search is performed for `from`

#### Scenario: Typed ID passed through
- **WHEN** `plan_trip` is called with `from: "address:a1"`
- **THEN** no location search is performed and the request carries `<AddressRef>a1</AddressRef>`

#### Scenario: Place without ID or coordinates
- **WHEN** a name resolves to a place with no ID and no coordinates
- **THEN** the tool returns an error naming that place and makes no further upstream call

#### Scenario: Unambiguous name
- **WHEN** `get_departures` is called with `stop: "Zürich HB"`
- **THEN** it resolves to the single matching stop and returns departures

#### Scenario: Ambiguous name
- **WHEN** `plan_trip` is called with `from: "Bahnhof"`
- **THEN** it returns an error stating `from` is ambiguous, with up to 5 candidates, and plans no trip

#### Scenario: Unknown name
- **WHEN** a name yields no locations
- **THEN** the tool returns an error stating no location matched that name

### Requirement: plan_trip
The system SHALL provide `plan_trip` taking `from`, `to`, optional `via` (place), optional `time` (default now), optional `arriveBy` (boolean, default false), and optional `limit` (default 3, max 10). Each trip SHALL include `departure`, `arrival`, `duration`, `transfers`, and `legs`. Each timed leg SHALL include `mode`, `line`, `direction`, `from`/`to` (name, planned and estimated time, platform), and `journeyRef` + `operatingDay` when available. Walk/transfer legs SHALL include `from`, `to`, and `duration`. Transfer legs SHALL take `mode` from their transfer type (default `walk`); continuous legs SHALL take it from their service mode (e.g. `bicycle`, `car`, `taxi`; `foot` reported as `walk`). Trips and legs SHALL include service disruption text (situations) and cancellation flags when present.

#### Scenario: Non-walking continuous leg
- **WHEN** a trip contains a continuous leg whose service mode is `bicycle`
- **THEN** that leg's `mode` is `bicycle`, not `walk`

#### Scenario: Depart-at trip
- **WHEN** called with `from: "Bern", to: "Zürich HB", time: "2026-11-02T08:00"`
- **THEN** it returns up to 3 trips departing at or after 08:00

#### Scenario: Arrive-by trip
- **WHEN** called with `arriveBy: true, time: "2026-11-02T18:00"`
- **THEN** it returns trips arriving at or before 18:00

#### Scenario: Leg references for details
- **WHEN** a returned trip contains a train leg
- **THEN** that leg carries `journeyRef` and `operatingDay` accepted by `get_trip_details`

### Requirement: get_departures
The system SHALL provide `get_departures` taking `stop` (name or ID), optional `time` (default now), optional `type` (`departure` default, or `arrival`), and optional `limit` (default 10, max 40). Each event SHALL include `line`, `mode`, `direction` (destination for departures, origin for arrivals), planned and estimated time, platform, cancellation flag, situations when present, and `journeyRef` + `operatingDay`. The request SHALL ask for realtime data with the OJP 2.0 `UseRealtimeData` parameter.

#### Scenario: Next departures
- **WHEN** called with `stop: "Bern"`
- **THEN** it returns up to 10 upcoming departures from Bern

#### Scenario: Arrivals
- **WHEN** called with `stop: "Bern", type: "arrival"`
- **THEN** it returns arrivals with the origin as `direction`

### Requirement: get_trip_details
The system SHALL provide `get_trip_details` taking `journeyRef` and `operatingDay` (YYYY-MM-DD). It SHALL return `line`, `mode`, `operator` when available, and the ordered list of calls, each with stop name, stop `id`, planned and estimated arrival/departure, platform, and cancellation flag, plus situations when present.

#### Scenario: Valid journey
- **WHEN** called with a `journeyRef`/`operatingDay` taken from a `plan_trip` or `get_departures` result
- **THEN** it returns the full ordered stop list of that journey

#### Scenario: Unknown journey
- **WHEN** a well-formed `journeyRef` (e.g. `ch:1:sjyid:…`) is not found upstream for that operating day
- **THEN** it returns an error stating the journey was not found for that operating day

#### Scenario: Upstream error condition
- **WHEN** the upstream returns no trip info but an OJP error condition
- **THEN** it returns that condition's text instead of the generic not-found message

#### Scenario: Malformed journeyRef
- **WHEN** the `journeyRef` is malformed and the upstream answers with HTTP 500
- **THEN** it returns the generic upstream error (`OJP service error: HTTP 500`), since the upstream gives no not-found signal
