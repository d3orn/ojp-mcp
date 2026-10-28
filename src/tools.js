import { ojpRequest, ojpErrorText, esc, arr, text } from './ojp.js'
import { toUtc, fmt } from './time.js'

const num = (x) => (x == null ? undefined : Number(x))
const flag = (...xs) => (xs.some((x) => x === 'true') ? true : undefined)
const norm = (s) => s?.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

function mapPlace(p) {
  const [type, code] = p.StopPlace ? ['stop', p.StopPlace.StopPlaceRef]
    : p.StopPoint ? ['stop', p.StopPoint.StopPointRef]
    : p.Address ? ['address', p.Address.PublicCode]
    : p.PointOfInterest ? ['poi', p.PointOfInterest.PublicCode]
    : p.TopographicPlace ? ['topographicPlace', p.TopographicPlace.TopographicPlaceCode]
    : ['location', undefined]
  const id = code && (type === 'stop' ? code : `${type}:${code}`)
  const modes = [...new Set(arr(p.Mode).map((m) => m.PtMode).filter(Boolean))]
  return {
    id, name: text(p.Name), type,
    lat: num(p.GeoPosition?.Latitude), lon: num(p.GeoPosition?.Longitude),
    modes: modes.length ? modes : undefined,
  }
}

const placeNames = (p) => [p.Name, p.StopPlace?.StopPlaceName, p.StopPoint?.StopPointName, p.TopographicPlace?.TopographicPlaceName]
  .map((n) => norm(text(n))).filter(Boolean)

const lirBody = ({ name, lat, lon, radius = 1000, types = [], limit }) => `<InitialInput>${name
  ? `<Name>${esc(name)}</Name>`
  : `<GeoRestriction><Circle><Center><siri:Longitude>${Number(lon)}</siri:Longitude><siri:Latitude>${Number(lat)}</siri:Latitude></Center><Radius>${Number(radius)}</Radius></Circle></GeoRestriction>`
}</InitialInput><Restrictions>${types.map((t) => `<Type>${esc(t)}</Type>`).join('')}<NumberOfResults>${Number(limit)}</NumberOfResults><IncludePtModes>true</IncludePtModes></Restrictions>`

export async function searchLocations({ name, lat, lon, radius, types, limit = 5, language = 'de' }) {
  if (!name && (lat == null || lon == null)) throw new Error('Provide either `name` or both `lat` and `lon`')
  const d = await ojpRequest('LocationInformation', lirBody({ name, lat, lon, radius, types, limit }), language)
  return arr(d.PlaceResult).slice(0, limit).map((r) => mapPlace(r.Place))
}

const STOP_ID_RE = /^(ch:\d+:\S+|\d+)$/
const TYPED_ID_RE = /^(address|poi|topographicPlace):(\S+)$/
const REF = { stop: 'siri:StopPointRef', address: 'AddressRef', poi: 'PointOfInterestRef', topographicPlace: 'TopographicPlaceRef' }

/** Name or ID → place. Throws with candidates if the name is ambiguous. */
export async function resolvePlace(input, field, types, language) {
  if (STOP_ID_RE.test(input)) return { id: input, name: input, type: 'stop' }
  if (TYPED_ID_RE.test(input)) return { id: input, name: input, type: TYPED_ID_RE.exec(input)[1] }
  const d = await ojpRequest('LocationInformation', lirBody({ name: input, types, limit: 5 }), language)
  const results = arr(d.PlaceResult).slice(0, 5).map((r) => r.Place)
  if (!results.length) throw new Error(`${field}: no location matched "${input}"`)
  const q = norm(input)
  const exact = results.filter((p) => placeNames(p).includes(q))
  if (results.length === 1 || (exact.length === 1 && exact[0] === results[0])) {
    const p = mapPlace(results[0])
    if (!p.id && p.lat == null) throw new Error(`${field}: "${p.name ?? input}" has no usable id or coordinates`)
    return p
  }
  const candidates = results.map(mapPlace).map(({ id, name, type }) => ({ id, name, type }))
  throw new Error(`${field} is ambiguous: "${input}". Use one of these ids: ${JSON.stringify(candidates)}`)
}

const placeRef = (p) => {
  const tag = p.id && REF[p.type]
  const ref = tag
    ? `<${tag}>${esc(p.type === 'stop' ? p.id : p.id.slice(p.type.length + 1))}</${tag}>`
    : `<GeoPosition><siri:Longitude>${Number(p.lon)}</siri:Longitude><siri:Latitude>${Number(p.lat)}</siri:Latitude></GeoPosition>`
  return ref + `<Name><Text>${esc(p.name)}</Text></Name>`
}

function situationMap(ctx) {
  const m = new Map()
  for (const s of arr(ctx?.Situations?.PtSituation)) {
    const tc = arr(s.PublishingActions?.PublishingAction)
      .flatMap((a) => arr(a.PassengerInformationAction)).map((a) => a.TextualContent).find(Boolean)
    const t = [tc?.SummaryContent?.SummaryText, tc?.ReasonContent?.ReasonText, tc?.ConsequenceContent?.ConsequenceText]
      .map((x) => arr(x)[0]).filter(Boolean).join(' ')
    if (t) m.set(s.SituationNumber, t)
  }
  return m
}

const situations = (sm, ...holders) => {
  const s = [...new Set(holders.flatMap((h) => arr(h?.SituationFullRefs?.SituationFullRef)).map((r) => sm.get(r.SituationNumber)).filter(Boolean))]
  return s.length ? s : undefined
}

const times = (t) => t && { planned: fmt(t.TimetabledTime), estimated: fmt(t.EstimatedTime) }
const platform = (c) => text(c.EstimatedQuay) ?? text(c.PlannedQuay)
const endpoint = (c, key) => ({ name: text(c.StopPointName), ...times(c[key]), platform: platform(c) })

function mapLeg(leg, sm) {
  const t = leg.TimedLeg
  if (t) {
    const s = t.Service
    return {
      mode: s.Mode?.PtMode, line: text(s.PublishedServiceName), direction: text(s.DestinationText),
      from: endpoint(t.LegBoard, 'ServiceDeparture'), to: endpoint(t.LegAlight, 'ServiceArrival'),
      journeyRef: s.JourneyRef, operatingDay: s.OperatingDayRef,
      cancelled: flag(s.Cancelled), situations: situations(sm, s),
    }
  }
  const w = leg.TransferLeg ?? leg.ContinuousLeg ?? {}
  const mode = leg.TransferLeg
    ? arr(w.TransferType)[0] ?? 'walk'
    : w.Service?.PersonalMode ?? w.Service?.Mode?.PtMode ?? w.Service?.AlternativeModeOfOperation ?? 'unknown'
  return {
    mode: mode === 'foot' ? 'walk' : mode,
    from: text(w.LegStart?.Name ?? w.LegStart?.LocationName),
    to: text(w.LegEnd?.Name ?? w.LegEnd?.LocationName),
    duration: w.Duration ?? leg.Duration,
  }
}

export async function planTrip({ from, to, via, time, arriveBy = false, limit = 3, language = 'de' }) {
  const types = ['stop', 'address', 'poi']
  const [o, dst, v] = await Promise.all([
    resolvePlace(from, 'from', types, language),
    resolvePlace(to, 'to', types, language),
    via && resolvePlace(via, 'via', types, language),
  ])
  const dep = `<DepArrTime>${toUtc(time)}</DepArrTime>`
  const body = `<Origin><PlaceRef>${placeRef(o)}</PlaceRef>${arriveBy ? '' : dep}</Origin>` +
    `<Destination><PlaceRef>${placeRef(dst)}</PlaceRef>${arriveBy ? dep : ''}</Destination>` +
    (v ? `<Via><ViaPoint>${placeRef(v)}</ViaPoint></Via>` : '') +
    `<Params><NumberOfResults>${Number(limit)}</NumberOfResults><UseRealtimeData>explanatory</UseRealtimeData></Params>`
  const d = await ojpRequest('Trip', body, language)
  const results = arr(d.TripResult)
  if (!results.length) throw new Error(ojpErrorText(d) ?? 'no trips found')
  const sm = situationMap(d.TripResponseContext)
  return results.slice(0, limit).map(({ Trip: t }) => ({
    departure: fmt(t.StartTime), arrival: fmt(t.EndTime), duration: t.Duration, transfers: num(t.Transfers),
    cancelled: flag(t.Cancelled), situations: situations(sm, t),
    legs: arr(t.Leg).map((l) => mapLeg(l, sm)),
  }))
}

export async function getDepartures({ stop, time, type = 'departure', limit = 10, language = 'de' }) {
  const p = await resolvePlace(stop, 'stop', ['stop'], language)
  const body = `<Location><PlaceRef>${placeRef(p)}</PlaceRef><DepArrTime>${toUtc(time)}</DepArrTime></Location>` +
    `<Params><NumberOfResults>${Number(limit)}</NumberOfResults><StopEventType>${type === 'arrival' ? 'arrival' : 'departure'}</StopEventType>` +
    `<IncludePreviousCalls>false</IncludePreviousCalls><IncludeOnwardCalls>false</IncludeOnwardCalls><UseRealtimeData>explanatory</UseRealtimeData></Params>`
  const d = await ojpRequest('StopEvent', body, language)
  const results = arr(d.StopEventResult)
  const err = !results.length && ojpErrorText(d)
  if (err) throw new Error(err)
  const sm = situationMap(d.StopEventResponseContext)
  const key = type === 'arrival' ? 'ServiceArrival' : 'ServiceDeparture'
  return results.slice(0, limit).map(({ StopEvent: e }) => {
    const c = e.ThisCall?.CallAtStop ?? {}
    const s = e.Service ?? {}
    return {
      line: text(s.PublishedServiceName), mode: s.Mode?.PtMode,
      direction: text(type === 'arrival' ? s.OriginText : s.DestinationText),
      ...times(c[key]), platform: platform(c),
      cancelled: flag(s.Cancelled, c.NotServicedStop), situations: situations(sm, s),
      journeyRef: s.JourneyRef, operatingDay: s.OperatingDayRef,
    }
  })
}

export async function getTripDetails({ journeyRef, operatingDay, language = 'de' }) {
  const body = `<JourneyRef>${esc(journeyRef)}</JourneyRef><OperatingDayRef>${esc(operatingDay)}</OperatingDayRef>`
  const d = await ojpRequest('TripInfo', body, language)
  const r = d.TripInfoResult
  if (!r) throw new Error(ojpErrorText(d) ?? `Journey "${journeyRef}" not found for operating day ${operatingDay}`)
  const s = r.Service ?? {}
  const sm = situationMap(d.TripInfoResponseContext)
  return {
    line: text(s.PublishedServiceName), mode: s.Mode?.PtMode, operator: s.OperatorRef,
    cancelled: flag(s.Cancelled), situations: situations(sm, s),
    calls: [...arr(r.PreviousCall), ...arr(r.OnwardCall)].map((x) => x.CallAtStop ?? x).map((c) => ({
      name: text(c.StopPointName), id: c.StopPointRef,
      arrival: times(c.ServiceArrival), departure: times(c.ServiceDeparture),
      platform: platform(c), cancelled: flag(c.NotServicedStop),
    })),
  }
}
