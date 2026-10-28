#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { safe } from './ojp.js'
import { searchLocations, planTrip, getDepartures, getTripDetails } from './tools.js'

if (!process.env.OJP_TOKEN?.trim()) {
  console.error('ojp-mcp: OJP_TOKEN environment variable is missing. Get a token at https://api-manager.opentransportdata.swiss and set OJP_TOKEN.')
  process.exit(1)
}

const language = z.enum(['de', 'fr', 'it', 'en']).optional().describe('Language for place/stop names and disruption texts (default de)')
const time = z.string().max(40).optional().describe('ISO time, e.g. 2026-11-02T08:00. Without offset it is Europe/Zurich local time. Default: now')
const place = (what) => z.string().min(1).max(200).describe(`${what}: a stop/place name (e.g. "Zürich HB") or an id from search_locations`)

const server = new McpServer({ name: 'ojp-mcp', version: '0.1.0' })

server.registerTool('search_locations', {
  description: 'Find Swiss public transport stops, addresses, POIs or towns by name or near coordinates. Returns ids usable in plan_trip and get_departures. Provide either name or lat+lon.',
  inputSchema: {
    name: z.string().min(1).max(200).optional().describe('Free-text place name'),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    radius: z.number().int().positive().max(50000).optional().describe('Search radius in meters around lat/lon (default 1000)'),
    types: z.array(z.enum(['stop', 'address', 'poi', 'topographicPlace'])).optional().describe('Restrict result types'),
    limit: z.number().int().min(1).max(20).optional().describe('Max results (default 5)'),
    language,
  },
}, safe(searchLocations))

server.registerTool('plan_trip', {
  description: 'Plan public transport journeys in Switzerland between two places. Returns trips with legs (line, platforms, planned/estimated times, disruptions). If a name is ambiguous the error lists candidate ids to retry with. Times are Europe/Zurich.',
  inputSchema: {
    from: place('Origin'),
    to: place('Destination'),
    via: place('Optional via point').optional(),
    time,
    arriveBy: z.boolean().optional().describe('If true, time is the latest arrival instead of earliest departure'),
    limit: z.number().int().min(1).max(10).optional().describe('Max trips (default 3)'),
    language,
  },
}, safe(planTrip))

server.registerTool('get_departures', {
  description: 'Live departure (or arrival) board for a Swiss public transport stop: line, direction, planned/estimated time, platform, cancellations, disruptions. Each event has journeyRef + operatingDay for get_trip_details.',
  inputSchema: {
    stop: place('Stop'),
    time,
    type: z.enum(['departure', 'arrival']).optional().describe('departure (default) or arrival'),
    limit: z.number().int().min(1).max(40).optional().describe('Max events (default 10)'),
    language,
  },
}, safe(getDepartures))

server.registerTool('get_trip_details', {
  description: 'Full ordered stop list of one vehicle journey (planned/estimated arrival and departure, platform, cancellations). Use journeyRef and operatingDay from a plan_trip leg or get_departures event.',
  inputSchema: {
    journeyRef: z.string().min(1).max(200),
    operatingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD'),
    language,
  },
}, safe(getTripDetails))

await server.connect(new StdioServerTransport())
