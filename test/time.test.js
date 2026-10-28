import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toUtc, fmt } from '../src/time.js'

test('naive input is Europe/Zurich', () => {
  assert.equal(toUtc('2026-11-02T08:00'), '2026-11-02T07:00:00.000Z')
  assert.equal(toUtc('2026-07-01T08:00:30'), '2026-07-01T06:00:30.000Z')
  assert.equal(toUtc('2026-07-01T08:00:30.5'), '2026-07-01T06:00:30.500Z')
})

test('input with offset is respected', () => {
  assert.equal(toUtc('2026-11-02T08:00:00Z'), '2026-11-02T08:00:00.000Z')
  assert.equal(toUtc('2026-11-02T08:00:00+02:00'), '2026-11-02T06:00:00.000Z')
})

test('DST boundaries (2026-03-29, 2026-10-25)', () => {
  assert.equal(toUtc('2026-03-29T01:30'), '2026-03-29T00:30:00.000Z')
  assert.equal(toUtc('2026-03-29T03:30'), '2026-03-29T01:30:00.000Z')
  assert.equal(fmt('2026-03-29T00:59:00Z'), '2026-03-29T01:59:00+01:00')
  assert.equal(fmt('2026-03-29T01:00:00Z'), '2026-03-29T03:00:00+02:00')
  assert.equal(fmt('2026-10-25T00:30:00Z'), '2026-10-25T02:30:00+02:00')
  assert.equal(fmt('2026-10-25T01:30:00Z'), '2026-10-25T02:30:00+01:00')
})

test('output format', () => {
  assert.equal(fmt('2026-11-02T07:04:00Z'), '2026-11-02T08:04:00+01:00')
  assert.equal(fmt('2025-05-29T15:18:24.5Z'), '2025-05-29T17:18:24+02:00')
  assert.equal(fmt(undefined), undefined)
  assert.equal(fmt('garbage'), undefined)
})

test('invalid and missing input', () => {
  assert.throws(() => toUtc('tomorrow'), /Invalid time/)
  assert.ok(Math.abs(Date.parse(toUtc()) - Date.now()) < 1000)
})
