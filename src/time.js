const dtf = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Zurich',
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
})

const offsetMs = (ms) => {
  const p = Object.fromEntries(dtf.formatToParts(ms).map(({ type, value }) => [type, Number(value)]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

/** Input time (naive = Europe/Zurich, or with offset/Z) → UTC ISO. Missing → now. */
export function toUtc(input) {
  if (!input) return new Date().toISOString()
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(input)
  let ms
  if (m) {
    const wall = Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6] ?? 0, (m[7] ?? '0').padEnd(3, '0'))
    ms = wall - offsetMs(wall)
    ms = wall - offsetMs(ms)
  } else {
    ms = Date.parse(input)
  }
  if (Number.isNaN(ms)) throw new Error(`Invalid time "${input}", expected e.g. 2026-11-02T08:00`)
  return new Date(ms).toISOString()
}

/** UTC ISO → Europe/Zurich ISO with offset, e.g. 2026-11-02T08:04:00+01:00. */
export function fmt(iso) {
  if (!iso) return undefined
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return undefined
  const off = offsetMs(ms)
  const sign = off < 0 ? '-' : '+'
  const h = String(Math.floor(Math.abs(off) / 3600000)).padStart(2, '0')
  const min = String((Math.abs(off) / 60000) % 60).padStart(2, '0')
  return new Date(ms + off).toISOString().slice(0, 19) + `${sign}${h}:${min}`
}
