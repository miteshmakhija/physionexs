import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Pressable, View, type LayoutChangeEvent } from 'react-native'
import Svg, { Circle, Line, Path } from 'react-native-svg'

import { Recovery } from '@/components/Recovery'
import { Card, Chip, Loading, Screen, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { dayParts } from '@shared/format'
import { colors, font } from '@shared/tokens'

// Same specs as the web charts: single series per chart, bars ≤24px with a 4px rounded top,
// 2px line, ≥8px dots with a 2px surface ring, hairline grid, and a tap readout (no hover on touch).
const BLUE = '#1170C2'
const GREEN = '#2C8E26'
const CHART_H = 150

type Day = Schemas['ProgressDay']

export default function ProgressTab() {
  const [range, setRange] = useState<'week' | 'month'>('week')
  const q = useQuery({ queryKey: ['progress', range], queryFn: () => api<Schemas['ProgressOut']>('/me/progress', { query: { range } }), placeholderData: (p) => p })
  if (!q.data) return <Loading />
  const p = q.data
  const delta = p.pain_now != null && p.pain_start != null ? p.pain_now - p.pain_start : null

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="title">Progress</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Chip label="Week" selected={range === 'week'} onPress={() => setRange('week')} />
          <Chip label="Month" selected={range === 'month'} onPress={() => setRange('month')} />
        </View>
      </View>
      <Recovery />
      {p.unlogged_doses_today > 0 && (
        <Card style={{ backgroundColor: colors.amberTint, borderColor: colors.amberTint }}>
          <Text style={{ color: colors.amber }}>You have {p.unlogged_doses_today} unlogged medicine dose(s) today.</Text>
        </Card>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Mini label="Adherence" value={p.adherence_pct == null ? '—' : `${p.adherence_pct}%`} sub={`this ${range}`} />
        <Mini label="Streak" value={`${p.streak_days}d`} sub={`best ${p.best_streak_days}d`} />
        <Mini label="Pain" value={p.pain_now == null ? '—' : `${p.pain_now}/10`} sub={delta == null ? '' : delta < 0 ? `down from ${p.pain_start}` : delta > 0 ? `up from ${p.pain_start}` : 'unchanged'} />
      </View>
      <Card style={{ gap: 8 }}>
        <Text variant="heading">Exercise completion</Text>
        <Text variant="caption">% of each day’s exercises done · tap a bar</Text>
        <Bars days={p.days} />
      </Card>
      <Card style={{ gap: 8 }}>
        <Text variant="heading">Pain level</Text>
        <Text variant="caption">Average logged per day, 0–10</Text>
        {p.days.some((d) => d.pain != null) ? <PainLine days={p.days} /> : <Text>No pain scores logged yet.</Text>}
      </Card>
    </Screen>
  )
}

function Mini({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <View style={{ flex: 1, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 2 }}>
      <Text variant="eyebrow">{label}</Text>
      <Text style={{ fontFamily: font.bold, fontSize: 20, color: colors.ink }}>{value}</Text>
      {!!sub && <Text variant="caption">{sub}</Text>}
    </View>
  )
}

function axisLabel(day: string, i: number, n: number) {
  const p = dayParts(day)
  if (n <= 7) return p.weekday
  return i % 7 === 0 || i === n - 1 ? String(p.date) : ''
}

function Bars({ days }: { days: Day[] }) {
  const [sel, setSel] = useState<number | null>(null)
  const [w, setW] = useState(300)
  const band = w / days.length
  const barW = Math.min(24, Math.max(3, band - 2))
  const s = sel != null ? days[sel] : null
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      <Text style={{ minHeight: 20, color: colors.ink, fontFamily: font.semibold }}>
        {s ? `${dayParts(s.day).long}: ${s.pct == null ? 'rest day' : `${s.pct}% (${s.done}/${s.scheduled})`}` : ' '}
      </Text>
      <View style={{ height: CHART_H, flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1, borderColor: colors.line }}>
        {days.map((d, i) => (
          <Pressable key={d.day} onPress={() => setSel(sel === i ? null : i)} style={{ width: band, height: CHART_H, justifyContent: 'flex-end', alignItems: 'center' }} accessibilityLabel={`${dayParts(d.day).long}, ${d.pct == null ? 'rest day' : `${d.pct} percent`}`}>
            {d.pct != null && d.pct > 0 && (
              <View style={{ width: barW, height: Math.max(2, (CHART_H - 8) * (d.pct / 100)), backgroundColor: BLUE, borderTopLeftRadius: 4, borderTopRightRadius: 4, opacity: sel == null || sel === i ? 1 : 0.55 }} />
            )}
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', marginTop: 4 }}>
        {days.map((d, i) => <Text key={d.day} style={{ width: band, textAlign: 'center', fontSize: 10.5, color: colors.muted }}>{axisLabel(d.day, i, days.length)}</Text>)}
      </View>
    </View>
  )
}

function PainLine({ days }: { days: Day[] }) {
  const [w, setW] = useState(300)
  const pad = 8
  const x = (i: number) => pad + ((w - 2 * pad) * i) / Math.max(1, days.length - 1)
  const y = (v: number) => pad + (CHART_H - 2 * pad) * (1 - v / 10)
  const pts = days.map((d, i) => ({ i, v: d.pain })).filter((p): p is { i: number; v: number } => p.v != null)
  const path = pts.map((p, k) => `${k === 0 || pts[k - 1].i !== p.i - 1 ? 'M' : 'L'}${x(p.i)},${y(p.v)}`).join(' ')
  const last = pts.at(-1)
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      <Svg width={w} height={CHART_H}>
        {[0, 5, 10].map((t) => <Line key={t} x1={0} x2={w} y1={y(t)} y2={y(t)} stroke={colors.line} strokeWidth={1} />)}
        <Path d={path} stroke={GREEN} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p) => <Circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={4} fill={GREEN} stroke="#fff" strokeWidth={2} />)}
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption">0–10 scale</Text>
        {last && <Text style={{ color: colors.ink, fontFamily: font.semibold }}>Latest {last.v}/10</Text>}
      </View>
    </View>
  )
}
