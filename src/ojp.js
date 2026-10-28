import { XMLParser } from 'fast-xml-parser'

const URL = 'https://api.opentransportdata.swiss/ojp20'
export const AUTH_MSG = 'OJP_TOKEN is invalid or not authorized for OJP 2.0'

const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, processEntities: { maxEntityCount: 1, maxEntitySize: 1 } })

export const esc = (s) => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
  .replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)
export const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x])
const one = (x) => (Array.isArray(x) ? x[0] : x)
export const text = (x) => one(one(x)?.Text ?? undefined)

const envelope = (kind, body, language) => {
  const now = new Date().toISOString()
  return `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0"><OJPRequest><siri:ServiceRequest><siri:ServiceRequestContext><siri:Language>${esc(language)}</siri:Language></siri:ServiceRequestContext><siri:RequestTimestamp>${now}</siri:RequestTimestamp><siri:RequestorRef>ojp-mcp</siri:RequestorRef><OJP${kind}Request><siri:RequestTimestamp>${now}</siri:RequestTimestamp>${body}</OJP${kind}Request></siri:ServiceRequest></OJPRequest></OJP>`
}

/** kind: LocationInformation | Trip | StopEvent | TripInfo. Returns the parsed OJP<kind>Delivery. */
export async function ojpRequest(kind, body, language = 'de') {
  let res, xml
  try {
    res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml', Accept: 'application/xml', Authorization: `Bearer ${process.env.OJP_TOKEN}` },
      body: envelope(kind, body, language),
      signal: AbortSignal.timeout(15000),
    })
    if (res.status === 401 || res.status === 403) throw new Error(AUTH_MSG)
    if (!res.ok) throw new Error(`OJP service error: HTTP ${res.status}`)
    xml = await res.text()
  } catch (e) {
    if (e.message === AUTH_MSG || e.message.startsWith('OJP service error')) throw e
    throw new Error(e.name === 'TimeoutError' ? 'OJP service timed out' : 'OJP service unreachable (network error)')
  }
  const delivery = parser.parse(xml)?.OJP?.OJPResponse?.ServiceDelivery?.[`OJP${kind}Delivery`]
  if (!delivery) throw new Error('Unexpected OJP response')
  return delivery
}

const firstString = (x) => {
  if (typeof x === 'string') return x || undefined
  for (const v of Object.values(x ?? {})) {
    const s = firstString(v)
    if (s) return s
  }
}

export const ojpErrorText = (delivery) => {
  const ec = delivery?.ErrorCondition
  return ec && `OJP error: ${firstString(ec.Description) ?? firstString(ec) ?? 'unknown'}`
}

export const redact = (s) => {
  const token = process.env.OJP_TOKEN
  return token ? s.replaceAll(token, '***') : s
}

export const safe = (handler) => async (args) => {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await handler(args)) }] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: redact(String(e?.message ?? e)) }] }
  }
}
