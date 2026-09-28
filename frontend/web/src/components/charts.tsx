// Small SVG charts for patient progress. Specs follow the dataviz guidance: single series per chart
// (title names it, no legend), bars ≤24px with a 4px rounded top on a shared baseline and a 2px gap,
// 2px lines, ≥8px markers with a 2px surface ring, hairline recessive grid, text in ink tokens,
// hover + keyboard-focus tooltips, and a table view so nothing depends on hovering.
import { useEffect, useId, useState } from 'react'

import { cx } from '@/components/ui'
import { dayParts } from '@shared/format'

const BLUE = '#1170C2' // adherence
const GREEN = '#2C8E26' // pain trend
const GRID = '#ECECED'
const SURFACE = '#FFFFFF'

export interface DayPoint {
  day: string // YYYY-MM-DD
  pct: number | null // null = nothing scheduled
  pain: number | null
  done: number
  scheduled: number
}

const H = 180
const PAD = { top: 16, right: 16, bottom: 28, left: 44 }

function useWidth() {
  const [el, setRef] = useState<HTMLDivElement | null>(null)
  const [w, setW] = useState(640)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return { setRef, w }
}

export function tickLabel(day: string, i: number, n: number) {
  const p = dayParts(day)
  if (n <= 7) return p.weekday
  return i % 5 === 0 || i === n - 1 ? String(p.date) : ''
}

function Tooltip({ x, y, value, label, width }: { x: number; y: number; value: string; label: string; width: number }) {
  const left = Math.min(Math.max(x, 60), width - 60)
  return (
    <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm border border-line bg-white px-2.5 py-1.5 text-center shadow-sm" style={{ left, top: y - 8 }}>
      <p className="text-[13px] font-semibold text-ink">{value}</p>
      <p className="text-[11.5px] text-muted">{label}</p>
    </div>
  )
}

export interface BarPoint {
  key: string
  label: string // axis label ('' to skip)
  value: number | null // null = no data (a faint dot on the baseline)
  readout: string // tooltip value, e.g. "67%" or "₹4,200"
  detail: string // tooltip secondary line
}

/** Single-series column chart. `max` fixes the scale (e.g. 100 for percentages); otherwise it's the data max. */
export function BarChart({ points, max, ticks, title, color = BLUE }: { points: BarPoint[]; max?: number; ticks: (m: number) => { v: number; label: string }[]; title: string; color?: string }) {
  const { setRef, w } = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const titleId = useId()
  const plotW = w - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const band = plotW / points.length
  const barW = Math.min(24, Math.max(3, band - 2)) // ≥2px surface gap between neighbours
  const top = max ?? niceMax(Math.max(0, ...points.map((p) => p.value ?? 0)))
  const y = (v: number) => PAD.top + plotH * (1 - (top ? v / top : 0))

  return (
    <div ref={setRef} className="relative">
      <svg width={w} height={H} role="img" aria-labelledby={titleId} className="block">
        <title id={titleId}>{title}</title>
        {ticks(top).map((t) => (
          <g key={t.v}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(t.v)} y2={y(t.v)} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t.v)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">{t.label}</text>
          </g>
        ))}
        {points.map((d, i) => {
          const cx0 = PAD.left + band * i + band / 2
          const h = d.value == null || !top ? 0 : Math.max(d.value > 0 ? 2 : 0, (plotH * d.value) / top)
          const x0 = cx0 - barW / 2
          const barTop = PAD.top + plotH - h
          const r = Math.min(4, h, barW / 2)
          // Rounded data-end, square at the baseline.
          const path = h > 0
            ? `M${x0},${PAD.top + plotH} V${barTop + r} Q${x0},${barTop} ${x0 + r},${barTop} H${x0 + barW - r} Q${x0 + barW},${barTop} ${x0 + barW},${barTop + r} V${PAD.top + plotH} Z`
            : ''
          return (
            <g key={d.key}>
              {path && <path d={path} fill={color} opacity={hover == null || hover === i ? 1 : 0.55} />}
              {d.value == null && <circle cx={cx0} cy={PAD.top + plotH - 3} r={1.5} fill={GRID} />}
              {d.label && <text x={cx0} y={H - 8} textAnchor="middle" className="fill-muted text-[11px]">{d.label}</text>}
              <rect
                x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent" tabIndex={0}
                aria-label={`${d.detail}: ${d.readout}`}
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                className="outline-none"
              />
            </g>
          )
        })}
      </svg>
      {hover != null && (
        <Tooltip width={w} x={PAD.left + band * hover + band / 2} y={points[hover].value == null ? PAD.top + plotH : y(points[hover].value!)} value={points[hover].readout} label={points[hover].detail} />
      )}
    </div>
  )
}

function niceMax(v: number) {
  if (v <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / mag / 2) * 2 * mag
}

export function AdherenceBars({ days }: { days: DayPoint[] }) {
  return (
    <BarChart
      title="Daily exercise completion, percent"
      max={100}
      ticks={() => [0, 50, 100].map((v) => ({ v, label: `${v}%` }))}
      points={days.map((d, i) => ({
        key: d.day,
        label: tickLabel(d.day, i, days.length),
        value: d.pct,
        readout: d.pct == null ? 'Rest day' : `${d.pct}%`,
        detail: `${dayParts(d.day).long}${d.pct != null ? ` · ${d.done}/${d.scheduled}` : ''}`,
      }))}
    />
  )
}

export function PainLine({ days }: { days: DayPoint[] }) {
  const { setRef, w } = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const titleId = useId()
  const plotW = w - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const step = days.length > 1 ? plotW / (days.length - 1) : 0
  const x = (i: number) => PAD.left + step * i
  const y = (v: number) => PAD.top + plotH * (1 - v / 10)
  const pts = days.map((d, i) => (d.pain == null ? null : { i, v: d.pain }))
  const known = pts.filter(Boolean) as { i: number; v: number }[]
  // Draw segments only between logged days so gaps stay visible.
  const path = known.map((p, k) => `${k === 0 || known[k - 1].i !== p.i - 1 ? 'M' : 'L'}${x(p.i)},${y(p.v)}`).join(' ')
  const last = known.at(-1)

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const i = Math.round((e.clientX - rect.left) / (step || 1))
    setHover(Math.max(0, Math.min(days.length - 1, i)))
  }

  return (
    <div ref={setRef} className="relative">
      <svg width={w} height={H} role="img" aria-labelledby={titleId} className="block">
        <title id={titleId}>Average pain logged per day, 0 to 10</title>
        {[0, 5, 10].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">{t}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const label = tickLabel(d.day, i, days.length)
          return label ? <text key={d.day} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted text-[11px]">{label}</text> : null
        })}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="#A7A7A9" strokeWidth={1} />}
        <path d={path} fill="none" stroke={GREEN} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {known.map((p) => (
          <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={4} fill={GREEN} stroke={SURFACE} strokeWidth={2} />
        ))}
        {last && hover == null && (
          <text x={x(last.i)} y={y(last.v) - 10} textAnchor={last.i > days.length / 2 ? 'end' : 'start'} className="fill-ink text-[12px] font-semibold">{last.v}/10</text>
        )}
        <rect
          x={PAD.left - step / 2}
          y={PAD.top}
          width={plotW + step}
          height={plotH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hover != null && (
        <Tooltip
          width={w}
          x={x(hover)}
          y={days[hover].pain == null ? PAD.top + plotH / 2 : y(days[hover].pain!)}
          value={days[hover].pain == null ? 'Not logged' : `${days[hover].pain}/10`}
          label={dayParts(days[hover].day).long}
        />
      )}
    </div>
  )
}

export function ProgressTable({ days }: { days: DayPoint[] }) {
  return (
    <table className="w-full text-left text-[13px]">
      <thead>
        <tr className="border-b border-line">
          {['Day', 'Exercises done', 'Completion', 'Pain'].map((h) => <th key={h} className="eyebrow py-2 font-semibold">{h}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-line tabular-nums">
        {days.map((d) => (
          <tr key={d.day}>
            <td className="py-1.5">{dayParts(d.day).long}</td>
            <td>{d.scheduled ? `${d.done} of ${d.scheduled}` : 'Rest day'}</td>
            <td>{d.pct == null ? '—' : `${d.pct}%`}</td>
            <td className={cx(d.pain == null && 'text-subtle')}>{d.pain == null ? '—' : `${d.pain}/10`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export interface MeasurePoint {
  at: string // ISO timestamp
  value: number
  trusted: boolean
}

/** One measure over time (e.g. right knee flexion) against a dashed target line. Held readings are hollow. */
export function MeasureTrend({ points, target, unit, lo, hi, title }: { points: MeasurePoint[]; target: number | null; unit: string; lo: number; hi: number; title: string }) {
  const { setRef, w } = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const titleId = useId()
  const sorted = [...points].sort((a, b) => a.at.localeCompare(b.at))
  const times = sorted.map((p) => new Date(p.at).getTime())
  const t0 = Math.min(...times)
  const t1 = Math.max(...times)
  const values = [...sorted.map((p) => p.value), ...(target != null ? [target] : [])]
  const pad = Math.max(5, (Math.max(...values) - Math.min(...values)) * 0.15)
  const yMin = Math.max(lo, Math.floor((Math.min(...values) - pad) / 10) * 10)
  const yMax = Math.min(hi, Math.ceil((Math.max(...values) + pad) / 10) * 10)
  const plotW = w - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (t: number) => (t1 === t0 ? PAD.left + plotW / 2 : PAD.left + ((t - t0) / (t1 - t0)) * plotW)
  const y = (v: number) => PAD.top + plotH * (1 - (v - yMin) / (yMax - yMin || 1))
  const trusted = sorted.map((p, i) => ({ ...p, i })).filter((p) => p.trusted)
  const path = trusted.map((p, k) => `${k ? 'L' : 'M'}${x(times[p.i])},${y(p.value)}`).join(' ')
  const ticks = [yMin, Math.round((yMin + yMax) / 2), yMax]
  const suffix = unit === 'deg' ? '°' : unit === 'score' ? '/10' : ` ${unit}`
  const fmt = (v: number) => `${v}${suffix}`

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left + PAD.left
    let best = 0
    times.forEach((t, i) => { if (Math.abs(x(t) - px) < Math.abs(x(times[best]) - px)) best = i })
    setHover(best)
  }

  return (
    <div ref={setRef} className="relative">
      <svg width={w} height={H} role="img" aria-labelledby={titleId} className="block">
        <title id={titleId}>{title}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">{fmt(t)}</text>
          </g>
        ))}
        {[0, sorted.length - 1].filter((i, k, a) => a.indexOf(i) === k && sorted[i]).map((i) => (
          <text key={i} x={x(times[i])} y={H - 8} textAnchor={sorted.length === 1 ? 'middle' : i === 0 ? 'start' : 'end'} className="fill-muted text-[11px]">
            {new Date(sorted[i].at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </text>
        ))}
        {target != null && (
          <g>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(target)} y2={y(target)} stroke="#646867" strokeWidth={1.5} strokeDasharray="4 4" />
            <text x={w - PAD.right} y={y(target) - 6} textAnchor="end" className="fill-muted text-[11px]">Target {fmt(target)}</text>
          </g>
        )}
        {hover != null && <line x1={x(times[hover])} x2={x(times[hover])} y1={PAD.top} y2={PAD.top + plotH} stroke="#A7A7A9" strokeWidth={1} />}
        <path d={path} fill="none" stroke={BLUE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {sorted.map((p, i) => (
          <circle key={i} cx={x(times[i])} cy={y(p.value)} r={4} fill={p.trusted ? BLUE : SURFACE} stroke={p.trusted ? SURFACE : '#A7A7A9'} strokeWidth={2} />
        ))}
        <rect x={PAD.left - 8} y={PAD.top} width={plotW + 16} height={plotH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover != null && (
        <Tooltip
          width={w}
          x={x(times[hover])}
          y={y(sorted[hover].value)}
          value={`${fmt(sorted[hover].value)}${sorted[hover].trusted ? '' : ' · held'}`}
          label={new Date(sorted[hover].at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
        />
      )}
    </div>
  )
}
