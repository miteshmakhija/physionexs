import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import Svg, { Circle, Line, Path } from 'react-native-svg'

import { Card, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayLabel, shortDate } from '@shared/format'
import { colors, font } from '@shared/tokens'

type Measure = Schemas['RecoveryMeasureOut']

const SIDE: Record<string, string> = { left: 'Left', right: 'Right' }
const fmt = (v: number, unit: string) => (unit === 'deg' ? `${v}°` : `${v} ${unit}`)
const BLUE = '#1170C2'
const CHART_H = 140

/** Progress tab: knee recovery against the physio's targets, plus pain and stiffness from daily check-ins. */
export function Recovery() {
  const q = useQuery({ queryKey: ['recovery'], queryFn: () => api<Schemas['RecoveryOut']>('/me/recovery') })
  const r = q.data
  if (!r?.available) return null
  const { measures = [], readings = [], checkins = [] } = r
  const last = checkins.at(-1)

  return (
    <View style={{ gap: 10 }}>
      <View>
        <Text variant="heading" style={{ fontSize: 17 }}>Knee recovery</Text>
        <Text variant="caption">
          {[r.weeks_since_surgery != null && `Week ${r.weeks_since_surgery} after surgery`, r.clinic_name && `measured at ${r.clinic_name}`].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {measures.map((m) => (
        <MeasureCard key={`${m.code}-${m.side}`} m={m} points={readings.filter((x) => x.code === m.code && x.side === m.side).map((x) => ({ day: x.measured_on, value: x.value }))} />
      ))}
      {last && (
        <Card style={{ gap: 4 }}>
          <Text variant="eyebrow">From your check-ins</Text>
          <Text style={{ color: colors.ink }}>
            Pain <Text style={{ fontFamily: font.bold, color: colors.ink }}>{last.pain}/10</Text> · Stiffness{' '}
            <Text style={{ fontFamily: font.bold, color: colors.ink }}>{last.stiffness}/10</Text>
          </Text>
          <Text variant="caption">
            {checkins.length > 1 ? `${checkins.length} check-ins in the last 30 days · latest ${dayLabel(last.day)}` : `Latest ${dayLabel(last.day)}`}
          </Text>
        </Card>
      )}
    </View>
  )
}

function MeasureCard({ m, points }: { m: Measure; points: { day: string; value: number }[] }) {
  const status = m.status === 'no_data'
    ? 'Your physio will measure this at your next visit.'
    : m.status === 'target_met'
      ? 'Target reached — well done.'
      : m.status === 'no_target'
        ? `Last measured ${dayLabel(m.latest_on!)}.`
        : `${m.progress_pct}% of the way from ${fmt(m.baseline!, m.unit)} to your target`
  return (
    <Card style={{ gap: 6 }}>
      <Text variant="eyebrow">{SIDE[m.side]} · {m.label}</Text>
      <Text style={{ fontFamily: font.extrabold, fontSize: 26, color: colors.ink }}>
        {m.latest != null ? fmt(m.latest, m.unit) : '—'}
        {m.target != null && (
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.muted }}> / target {fmt(m.target, m.unit)}{m.by_week ? ` by week ${m.by_week}` : ''}</Text>
        )}
      </Text>
      {m.progress_pct != null && (
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.line }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: m.progress_pct }}>
          <View style={{ height: 6, borderRadius: 3, width: `${m.progress_pct}%`, backgroundColor: m.status === 'target_met' ? colors.leaf : colors.brand }} />
        </View>
      )}
      <Text variant="caption">{status}</Text>
      {points.length > 1 && <Trend points={points} target={m.target} unit={m.unit} />}
      {m.hint && <Text variant="caption" style={{ color: colors.subtle }}>{m.hint}</Text>}
    </Card>
  )
}

/** Readings over time (x by date) with a dashed target line. */
function Trend({ points, target, unit }: { points: { day: string; value: number }[]; target: number | null | undefined; unit: string }) {
  const [w, setW] = useState(300)
  const pad = 10
  const t = points.map((p) => new Date(p.day).getTime())
  const t0 = Math.min(...t)
  const t1 = Math.max(...t)
  const vals = [...points.map((p) => p.value), ...(target != null ? [target] : [])]
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 5) / 10) * 10)
  const hi = Math.ceil((Math.max(...vals) + 5) / 10) * 10
  const x = (ms: number) => (t1 === t0 ? w / 2 : pad + ((w - 2 * pad) * (ms - t0)) / (t1 - t0))
  const y = (v: number) => pad + (CHART_H - 2 * pad) * (1 - (v - lo) / (hi - lo || 1))
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(t[i])},${y(p.value)}`).join(' ')
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ marginTop: 6 }}>
      <Svg width={w} height={CHART_H}>
        {[lo, hi].map((v) => <Line key={v} x1={0} x2={w} y1={y(v)} y2={y(v)} stroke={colors.line} strokeWidth={1} />)}
        {target != null && <Line x1={0} x2={w} y1={y(target)} y2={y(target)} stroke={colors.muted} strokeWidth={1.5} strokeDasharray="4 4" />}
        <Path d={path} stroke={BLUE} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => <Circle key={p.day + i} cx={x(t[i])} cy={y(p.value)} r={4} fill={BLUE} stroke="#fff" strokeWidth={2} />)}
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption">{shortDate(points[0].day)}</Text>
        {target != null && <Text variant="caption">- - target {fmt(target, unit)}</Text>}
        <Text variant="caption">{shortDate(points.at(-1)!.day)}</Text>
      </View>
    </View>
  )
}
