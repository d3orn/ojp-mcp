import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { ojpRequest, safe, esc, AUTH_MSG } from '../src/ojp.js'

const TOKEN = 'secret-token-abc123'
const realFetch = globalThis.fetch
let lastInit

beforeEach(() => { process.env.OJP_TOKEN = TOKEN })
afterEach(() => { globalThis.fetch = realFetch })

const mockFetch = (impl) => { globalThis.fetch = async (url, init) => { lastInit = init; return impl() } }
const callTool = () => safe(() => ojpRequest('Trip', '<x/>'))({})

const assertToolError = async (expected) => {
  const r = await callTool()
  assert.equal(r.isError, true)
  assert.match(r.content[0].text, expected)
  assert.ok(!r.content[0].text.includes(TOKEN))
}

test('sends Bearer token', async () => {
  mockFetch(() => new Response('<OJP><OJPResponse><ServiceDelivery><OJPTripDelivery><CalcTime>1</CalcTime></OJPTripDelivery></ServiceDelivery></OJPResponse></OJP>'))
  await ojpRequest('Trip', '<x/>')
  assert.equal(lastInit.headers.Authorization, `Bearer ${TOKEN}`)
  assert.equal(lastInit.headers['Content-Type'], 'application/xml')
})

test('401 and 403 map to the fixed message', async () => {
  for (const status of [401, 403]) {
    mockFetch(() => new Response('{"error":"Authorization field missing"}', { status }))
    const r = await callTool()
    assert.equal(r.content[0].text, AUTH_MSG)
  }
})

test('network failure hides details and token', async () => {
  mockFetch(() => { throw new TypeError(`fetch failed: Authorization: Bearer ${TOKEN}`) })
  await assertToolError(/^OJP service unreachable/)
})

test('timeout', async () => {
  mockFetch(() => { throw new DOMException('signal timed out', 'TimeoutError') })
  await assertToolError(/^OJP service timed out$/)
})

test('other HTTP status → status only', async () => {
  mockFetch(() => new Response(`boom ${TOKEN}`, { status: 500 }))
  await assertToolError(/^OJP service error: HTTP 500$/)
})

test('token in any thrown message is redacted', async () => {
  const r = await safe(() => { throw new Error(`leak ${TOKEN}`) })({})
  assert.equal(r.content[0].text, 'leak ***')
})

test('esc escapes markup and strips XML-illegal characters', () => {
  assert.equal(esc('a<b>&"\'\u0000\u001F\uD800 ü 😀'), 'a&#60;b&#62;&#38;&#34;&#39; ü 😀')
})

test('DTD entities are rejected', async () => {
  mockFetch(() => new Response('<!DOCTYPE OJP [<!ENTITY e "BOOM">]><OJP><OJPResponse><ServiceDelivery><OJPTripDelivery>&e;</OJPTripDelivery></ServiceDelivery></OJPResponse></OJP>'))
  await assert.rejects(ojpRequest('Trip', '<x/>'))
})
