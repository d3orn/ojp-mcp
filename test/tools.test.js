import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { searchLocations, resolvePlace, planTrip, getDepartures, getTripDetails } from '../src/tools.js'

const fixture = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')
const realFetch = globalThis.fetch
let bodies

beforeEach(() => { process.env.OJP_TOKEN = 't'; bodies = [] })
afterEach(() => { globalThis.fetch = realFetch })

/** Responds by request type: { LocationInformation: xml, Trip: xml, ... } */
const mockOjp = (map) => {
  globalThis.fetch = async (url, init) => {
    bodies.push(init.body)
    const kind = /<OJP(\w+)Request>/.exec(init.body)[1]
    return new Response(map[kind])
  }
}

const lir = (...places) => `<OJP><OJPResponse><ServiceDelivery><OJPLocationInformationDelivery><CalcTime>1</CalcTime>${places
  .map(([id, name]) => `<PlaceResult><Place><StopPlace><StopPlaceRef>${id}</StopPlaceRef><StopPlaceName><Text>${name}</Text></StopPlaceName></StopPlace><Name><Text>${name}</Text></Name><GeoPosition><Longitude>7</Longitude><Latitude>46</Latitude></GeoPosition></Place></PlaceResult>`)
  .join('')}</OJPLocationInformationDelivery></ServiceDelivery></OJPResponse></OJP>`

test('search_locations maps the LIR fixture', async () => {
  mockOjp({ LocationInformation: fixture('lir.xml') })
  const r = await searchLocations({ name: 'Bern', limit: 20 })
  assert.deepEqual(r[0], { id: '8507000', name: 'Bern (Bern)', type: 'stop', lat: 46.94883, lon: 7.43913, modes: ['rail'] })
  assert.deepEqual(r[1].modes, ['tram', 'bus'])
  assert.equal(r.at(-1).type, 'topographicPlace')
  assert.match(bodies[0], /<Name>Bern<\/Name>.*<NumberOfResults>20<\/NumberOfResults>/)
  assert.match(bodies[0], /<siri:Language>de<\/siri:Language>/)
})

test('search_locations by coordinates and input error', async () => {
  mockOjp({ LocationInformation: lir() })
  await searchLocations({ lat: 47.3766, lon: 8.5389, types: ['stop'], language: 'fr' })
  assert.match(bodies[0], /<Radius>1000<\/Radius>.*<Type>stop<\/Type>/)
  assert.match(bodies[0], /<siri:Language>fr<\/siri:Language>/)
  await assert.rejects(searchLocations({}), /Provide either/)
})

test('resolver: id passthrough does no lookup', async () => {
  mockOjp({})
  assert.equal((await resolvePlace('ch:1:sloid:7000', 'from', ['stop'])).id, 'ch:1:sloid:7000')
  assert.equal((await resolvePlace('8507000', 'from', ['stop'])).id, '8507000')
  assert.equal(bodies.length, 0)
})

test('resolver: unique, exact-name-wins, ambiguous, none', async () => {
  mockOjp({ LocationInformation: lir(['1', 'Somewhere']) })
  assert.equal((await resolvePlace('somewh', 'stop', ['stop'])).id, '1')

  mockOjp({ LocationInformation: fixture('lir.xml') })
  assert.equal((await resolvePlace('bern', 'stop', ['stop'])).id, '8507000')

  mockOjp({ LocationInformation: lir(['1', 'Bahnhof A'], ['2', 'Bahnhof B']) })
  await assert.rejects(resolvePlace('Bahnhof', 'from', ['stop']), (e) => {
    assert.match(e.message, /^from is ambiguous/)
    assert.match(e.message, /"id":"2"/)
    return true
  })

  mockOjp({ LocationInformation: lir() })
  await assert.rejects(resolvePlace('Nowhere', 'to', ['stop']), /no location matched "Nowhere"/)
})

test('resolver: diacritics-insensitive exact match', async () => {
  mockOjp({ LocationInformation: lir(['8503000', 'Zürich HB'], ['8503003', 'Zürich HB SZU']) })
  assert.equal((await resolvePlace('zurich hb', 'stop', ['stop'])).id, '8503000')
})

test('plan_trip maps the TR fixture', async () => {
  mockOjp({ Trip: fixture('tr.xml') })
  const trips = await planTrip({ from: '8504577', to: '8504550', time: '2025-05-29T17:00', limit: 6 })
  assert.equal(trips.length, 6)
  const [t0, t1] = trips
  assert.equal(t0.departure, '2025-05-29T17:05:00+02:00')
  assert.equal(t0.duration, 'PT1H55M')
  assert.equal(t0.transfers, 0)
  const boat = t0.legs[0]
  assert.equal(boat.mode, 'water')
  assert.equal(boat.line, '3212')
  assert.equal(boat.journeyRef, 'ojp:94321:2:H:j25:2')
  assert.equal(boat.operatingDay, '2025-05-29')
  assert.equal(boat.from.name, 'Murten/Morat (Schiff/bateau)')
  assert.ok(boat.situations?.length >= 1)
  assert.deepEqual(t1.legs[0], { mode: 'walk', from: 'Murten/Morat (Schiff/bateau)', to: 'Murten/Morat', duration: 'PT13M' })
  assert.deepEqual(t1.legs[1].from, { name: 'Murten/Morat', planned: '2025-05-29T17:18:00+02:00', estimated: '2025-05-29T17:18:24+02:00', platform: '4' })
  assert.match(bodies[0], /<Origin><PlaceRef><siri:StopPointRef>8504577<\/siri:StopPointRef>.*<DepArrTime>2025-05-29T15:00:00.000Z<\/DepArrTime><\/Origin>/)
})

test('plan_trip arriveBy puts time on destination; error condition surfaced', async () => {
  mockOjp({ Trip: '<OJP><OJPResponse><ServiceDelivery><OJPTripDelivery><ErrorCondition><OtherError/><Description>TRIP_NOTRIPFOUND</Description></ErrorCondition></OJPTripDelivery></ServiceDelivery></OJPResponse></OJP>' })
  await assert.rejects(planTrip({ from: '1', to: '2', time: '2026-11-02T18:00', arriveBy: true }), /OJP error: TRIP_NOTRIPFOUND/)
  assert.match(bodies[0], /<Destination><PlaceRef>.*<DepArrTime>2026-11-02T17:00:00.000Z<\/DepArrTime><\/Destination>/)
})

test('get_departures maps the SER fixture', async () => {
  mockOjp({ StopEvent: fixture('ser.xml') })
  const [e] = await getDepartures({ stop: 'ch:1:sloid:83724' })
  assert.deepEqual(JSON.parse(JSON.stringify(e)), {
    line: '560', mode: 'bus', direction: 'Chevroux',
    planned: '2025-06-02T12:16:00+02:00', estimated: '2025-06-02T12:16:00+02:00',
    situations: ['Bus services of line 560 are running at irregular intervals. This is due to an accident. Expect delays.'],
    journeyRef: 'ojp:96231:_x0020_:H:j25:8', operatingDay: '2025-06-02',
  })
})

test('get_departures arrivals use origin as direction', async () => {
  mockOjp({ StopEvent: fixture('ser.xml') })
  const [e] = await getDepartures({ stop: 'ch:1:sloid:83724', type: 'arrival' })
  assert.equal(e.direction, 'Payerne, gare')
  assert.match(bodies[0], /<StopEventType>arrival<\/StopEventType>/)
})

test('get_trip_details maps the TIR fixture', async () => {
  mockOjp({ TripInfo: fixture('tir.xml') })
  const r = await getTripDetails({ journeyRef: 'ch:1:sjyid:100015:3349-001', operatingDay: '2026-10-28' })
  assert.equal(r.line, 'IR65')
  assert.equal(r.mode, 'rail')
  assert.equal(r.operator, 'ojp:33')
  assert.deepEqual(r.calls.map((c) => c.name), ['Bern', 'Lyss', 'Biel/Bienne'])
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls[1])), {
    name: 'Lyss', id: 'ch:1:sloid:4414:1:1',
    arrival: { planned: '2026-10-28T13:28:00+01:00', estimated: '2026-10-28T13:28:00+01:00' },
    departure: { planned: '2026-10-28T13:30:00+01:00', estimated: '2026-10-28T13:30:12+01:00' },
    platform: '1',
  })
  assert.match(bodies[0], /<JourneyRef>ch:1:sjyid:100015:3349-001<\/JourneyRef><OperatingDayRef>2026-10-28<\/OperatingDayRef>/)
})

test('get_trip_details not found', async () => {
  mockOjp({ TripInfo: '<OJP><OJPResponse><ServiceDelivery><OJPTripInfoDelivery><CalcTime>1</CalcTime></OJPTripInfoDelivery></ServiceDelivery></OJPResponse></OJP>' })
  await assert.rejects(getTripDetails({ journeyRef: 'x', operatingDay: '2026-10-28' }), /Journey "x" not found for operating day 2026-10-28/)
})

test('get_departures enforces limit client-side', async () => {
  mockOjp({ StopEvent: fixture('ser.xml') })
  assert.equal((await getDepartures({ stop: 'ch:1:sloid:83724', limit: 3 })).length, 3)
})

const place = (inner) => `<OJP><OJPResponse><ServiceDelivery><OJPLocationInformationDelivery><PlaceResult><Place>${inner}<Name><Text>X</Text></Name></Place></PlaceResult></OJPLocationInformationDelivery></ServiceDelivery></OJPResponse></OJP>`

test('address/poi ids are typed and round-trip as their own ref element', async () => {
  mockOjp({ LocationInformation: place('<Address><PublicCode>a1</PublicCode></Address>') })
  assert.equal((await searchLocations({ name: 'X' }))[0].id, 'address:a1')
  mockOjp({ Trip: '<OJP><OJPResponse><ServiceDelivery><OJPTripDelivery/></ServiceDelivery></OJPResponse></OJP>' })
  await assert.rejects(planTrip({ from: 'address:a1', to: 'poi:p2', via: 'topographicPlace:t:3' }))
  assert.equal(bodies.length, 2)
  assert.match(bodies[1], /<Origin><PlaceRef><AddressRef>a1<\/AddressRef>/)
  assert.match(bodies[1], /<Destination><PlaceRef><PointOfInterestRef>p2<\/PointOfInterestRef>/)
  assert.match(bodies[1], /<ViaPoint><TopographicPlaceRef>t:3<\/TopographicPlaceRef>/)
})

test('resolver: place without id falls back to coordinates, else errors', async () => {
  mockOjp({ LocationInformation: place('<GeoPosition><Longitude>7.4</Longitude><Latitude>46.9</Latitude></GeoPosition>'), Trip: '<OJP><OJPResponse><ServiceDelivery><OJPTripDelivery/></ServiceDelivery></OJPResponse></OJP>' })
  await assert.rejects(planTrip({ from: 'X', to: '1' }))
  assert.match(bodies[1], /<Origin><PlaceRef><GeoPosition><siri:Longitude>7.4<\/siri:Longitude>/)
  mockOjp({ LocationInformation: place('') })
  await assert.rejects(resolvePlace('X', 'from', ['stop']), /from: "X" has no usable id or coordinates/)
})

test('continuous legs report their own mode', async () => {
  const trip = (leg) => `<OJP><OJPResponse><ServiceDelivery><OJPTripDelivery><TripResult><Trip><Leg>${leg}</Leg></Trip></TripResult></OJPTripDelivery></ServiceDelivery></OJPResponse></OJP>`
  mockOjp({ Trip: trip('<ContinuousLeg><Service><PersonalModeOfOperation>self</PersonalModeOfOperation><PersonalMode>bicycle</PersonalMode></Service></ContinuousLeg>') })
  assert.equal((await planTrip({ from: '1', to: '2' }))[0].legs[0].mode, 'bicycle')
  mockOjp({ Trip: trip('<ContinuousLeg><Service><PersonalMode>foot</PersonalMode></Service></ContinuousLeg>') })
  assert.equal((await planTrip({ from: '1', to: '2' }))[0].legs[0].mode, 'walk')
})

test('get_departures requests realtime data with the OJP 2.0 element', async () => {
  mockOjp({ StopEvent: fixture('ser.xml') })
  await getDepartures({ stop: 'ch:1:sloid:83724' })
  assert.match(bodies[0], /<UseRealtimeData>explanatory<\/UseRealtimeData>/)
})

test('get_trip_details surfaces the OJP error condition', async () => {
  mockOjp({ TripInfo: '<OJP><OJPResponse><ServiceDelivery><OJPTripInfoDelivery><ErrorCondition><Description>TRIPINFO_JOURNEYREFUNKNOWN</Description></ErrorCondition></OJPTripInfoDelivery></ServiceDelivery></OJPResponse></OJP>' })
  await assert.rejects(getTripDetails({ journeyRef: 'x', operatingDay: '2026-10-28' }), /OJP error: TRIPINFO_JOURNEYREFUNKNOWN/)
})

test('search_locations enforces limit client-side', async () => {
  mockOjp({ LocationInformation: fixture('lir.xml') })
  assert.equal((await searchLocations({ name: 'Bern', limit: 2 })).length, 2)
})
