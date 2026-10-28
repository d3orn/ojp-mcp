# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

MCP (Model Context Protocol) server exposing an **OJP 2.0** (Open Journey Planner, CEN/TS 17118) backend as tools for LLM clients. Runs locally over stdio; each user supplies their own token via env.

## Commands

- Install: `npm install`
- Test: `npm test` (`node --test`, fixtures in `test/fixtures/`)
- Run: `OJP_TOKEN=… node src/index.js` (stdio; exits if token missing)

## Layout

Plain JS, ESM, Node ≥ 20, no build step.

- `src/ojp.js` — the only HTTP path: XML envelope, Bearer auth, 15 s timeout, error mapping, token redaction (`safe`). Never log to stdout (it's the MCP channel).
- `src/tools.js` — LIR/TR/SER/TIR body templates, name-or-ID resolver, per-tool output mapping.
- `src/time.js` — Europe/Zurich ↔ UTC via `Intl`.
- `src/index.js` — MCP server + zod input schemas.

## OJP 2.0 domain notes

- Protocol is XML over HTTP POST: `<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">` → `OJPRequest` → `siri:ServiceRequest` → one `OJP…Request`. Default namespace is `ojp`, `siri:` is prefixed (inverse of 1.0).
- Request types used (one MCP tool each): `OJPLocationInformationRequest`, `OJPTripRequest`, `OJPStopEventRequest`, `OJPTripInfoRequest`. Fares are a separate API, out of scope.
- Target OJP **2.0** only — 1.0 element names/namespaces differ; don't mix schemas.
- Backend: `https://api.opentransportdata.swiss/ojp20`, Bearer (JWT) auth, `Content-Type: application/xml`. Stop IDs are SLOIDs (`ch:1:sloid:3000`). Token in env, never in code, output, or logs.
- Reference: request examples in `openTdataCH/api-explorer` → `public/openapi/ojp2.0/openapi.template.yaml`. Official JS SDK: `ojp-sdk` (openTdataCH/ojp-js).
