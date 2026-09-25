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

function tickLabel(day: string, i: number, n: number) {
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

export function AdherenceBars({ days }: { days: DayPoint[] }) {
  const { setRef, w } = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const titleId = useId()
  const plotW = w - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const band = plotW / days.length
  const barW = Math.min(24, Math.max(4, band - 2)) // ≥2px surface gap between neighbours
  const y = (pct: number) => PAD.top + plotH * (1 - pct / 100)

  return (
    <div ref={setRef} className="relative">
      <svg width={w} height={H} role="img" aria-labelledby={titleId} className="block">
        <title id={titleId}>Daily exercise completion, percent</title>
        {[0, 50, 100].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">{t}%</text>
          </g>
        ))}
        {days.map((d, i) => {
          const cx0 = PAD.left + band * i + band / 2
          const h = d.pct == null ? 0 : Math.max(d.pct > 0 ? 2 : 0, (plotH * d.pct) / 100)
          const x0 = cx0 - barW / 2
          const top = PAD.top + plotH - h
          const r = Math.min(4, h, barW / 2)
          // Rounded data-end, square at the baseline.
          const path = h > 0
            ? `M${x0},${PAD.top + plotH} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${PAD.top + plotH} Z`
            : ''
          const label = tickLabel(d.day, i, days.length)
          return (
            <g key={d.day}>
              {path && <path d={path} fill={BLUE} opacity={hover == null || hover === i ? 1 : 0.55} />}
              {d.pct == null && <circle cx={cx0} cy={PAD.top + plotH - 3} r={1.5} fill={GRID} />}
              {label && <text x={cx0} y={H - 8} textAnchor="middle" className="fill-muted text-[11px]">{label}</text>}
              <rect
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${dayParts(d.day).long}: ${d.pct == null ? 'rest day' : `${d.pct}% (${d.done} of ${d.scheduled})`}`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="outline-none"
              />
            </g>
          )
        })}
      </svg>
      {hover != null && (
        <Tooltip
          width={w}
          x={PAD.left + band * hover + band / 2}
          y={days[hover].pct == null ? PAD.top + plotH : y(days[hover].pct!)}
          value={days[hover].pct == null ? 'Rest day' : `${days[hover].pct}%`}
          label={`${dayParts(days[hover].day).long}${days[hover].pct != null ? ` · ${days[hover].done}/${days[hover].scheduled}` : ''}`}
        />
      )}
    </div>
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
