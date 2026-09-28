import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, Linking, Pressable, View } from 'react-native'

import { Button, Card, Chip, ErrorText, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { EXERCISES, SLEEP, SWELLING, labelOf, type Exercises, type Sleep, type Swelling } from '@shared/checkin'
import { isoDay } from '@shared/format'
import { colors, font, radius } from '@shared/tokens'

type State = Schemas['CheckinStateOut']
type Advice = Schemas['AdviceOut']

/** Patient home: the 30-second daily recovery check-in (only for plans that use it, e.g. knee replacement). */
export function CheckinCard() {
  const day = isoDay()
  const q = useQuery({ queryKey: ['checkin', day], queryFn: () => api<State>('/me/checkin', { query: { day } }) })
  const [editing, setEditing] = useState(false)
  const [advice, setAdvice] = useState<Advice | null>(null)
  const s = q.data
  if (!s?.eligible) return null
  const shown = advice ?? s.advice

  return (
    <View style={{ gap: 12 }}>
      {shown && <AdviceBox advice={shown} />}
      {!s.consent.granted ? (
        <ConsentCard state={s} />
      ) : s.today && !editing ? (
        <Summary state={s} onEdit={() => setEditing(true)} />
      ) : (
        <CheckinForm state={s} day={day} onDone={(a) => { setAdvice(a); setEditing(false) }} onCancel={s.today ? () => setEditing(false) : undefined} />
      )}
    </View>
  )
}

function AdviceBox({ advice }: { advice: Advice }) {
  const emergency = advice.level === 'emergency'
  return (
    <View accessibilityRole="alert" style={{ borderWidth: 2, borderColor: colors.danger, backgroundColor: emergency ? colors.danger : colors.dangerTint, borderRadius: radius.lg, padding: 18, gap: 6 }}>
      <Text style={{ fontFamily: font.bold, fontSize: 18, color: emergency ? '#fff' : colors.ink }}>{advice.title}</Text>
      <Text style={{ color: emergency ? '#fff' : colors.ink2 }}>{advice.body}</Text>
      {advice.call_number && (
        <Pressable
          accessibilityRole="button"
          onPress={() => void Linking.openURL(`tel:${advice.call_number}`)}
          style={{ marginTop: 8, alignSelf: 'flex-start', backgroundColor: emergency ? '#fff' : colors.danger, borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 12 }}
        >
          <Text style={{ fontFamily: font.bold, color: emergency ? colors.danger : '#fff' }}>{advice.call_label}</Text>
        </Pressable>
      )}
    </View>
  )
}

function ConsentCard({ state }: { state: State }) {
  const qc = useQueryClient()
  const [later, setLater] = useState(false)
  const agree = useMutation({
    mutationFn: () => api('/me/consents', { method: 'POST', json: { purpose: 'twin_tracking', version: state.consent.version } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checkin'] }),
  })
  if (later) return null
  return (
    <Card style={{ gap: 10 }}>
      <Text variant="eyebrow">Daily recovery check-in · {state.plan?.clinic_name}</Text>
      <Text variant="heading" style={{ fontSize: 17 }}>{state.consent.title}</Text>
      <Text>{state.consent.body}</Text>
      {agree.error && <ErrorText>{(agree.error as Error).message}</ErrorText>}
      <Button title="I agree" onPress={() => agree.mutate()} loading={agree.isPending} />
      <Button title="Not now" variant="ghost" onPress={() => setLater(true)} />
    </Card>
  )
}

function Summary({ state, onEdit }: { state: State; onEdit: () => void }) {
  const qc = useQueryClient()
  const t = state.today!
  const stop = useMutation({
    mutationFn: () => api('/me/consents/twin_tracking', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checkin'] }),
  })
  const confirmStop = () =>
    Alert.alert('Stop sharing check-ins?', 'Your physio will no longer get your daily check-ins. You can turn it back on later.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop sharing', style: 'destructive', onPress: () => stop.mutate() },
    ])
  return (
    <Card style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="eyebrow">Today’s check-in ✓</Text>
        <Pressable onPress={onEdit} accessibilityRole="button"><Text variant="eyebrow" style={{ color: colors.ink }}>Edit</Text></Pressable>
      </View>
      <Text style={{ color: colors.ink }}>
        Pain {t.pain}/10 · Stiffness {t.stiffness}/10 · Swelling {labelOf(SWELLING, t.swelling).toLowerCase()} · Slept {labelOf(SLEEP, t.sleep).toLowerCase()}
      </Text>
      <Text variant="caption">Your physio at {state.plan?.clinic_name} can see this. Check in again tomorrow.</Text>
      {state.whatsapp && <WhatsAppOptIn wa={state.whatsapp} />}
      <Pressable onPress={confirmStop} accessibilityRole="button" style={{ marginTop: 4 }}>
        <Text variant="caption" style={{ textDecorationLine: 'underline' }}>Stop sharing check-ins</Text>
      </Pressable>
    </Card>
  )
}

function CheckinForm({ state, day, onDone, onCancel }: { state: State; day: string; onDone: (a: Advice | null) => void; onCancel?: () => void }) {
  const qc = useQueryClient()
  const t = state.today
  const [pain, setPain] = useState<number | null>(t?.pain ?? null)
  const [stiffness, setStiffness] = useState<number | null>(t?.stiffness ?? null)
  const [swelling, setSwelling] = useState<Swelling | null>((t?.swelling as Swelling) ?? null)
  const [sleep, setSleep] = useState<Sleep | null>((t?.sleep as Sleep) ?? null)
  const [exercises, setExercises] = useState<Exercises | null>((t?.exercises as Exercises) ?? null)
  const [flags, setFlags] = useState<string[]>(t?.red_flags ?? [])
  const [noFlags, setNoFlags] = useState(!!t && !t.red_flags.length)
  const ready = pain != null && stiffness != null && !!swelling && !!sleep && !!exercises && (noFlags || flags.length > 0)

  const save = useMutation({
    mutationFn: () => api<Schemas['CheckinResultOut']>('/me/checkins', { method: 'POST', json: { day, pain, stiffness, swelling, sleep, exercises, red_flags: noFlags ? [] : flags } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['checkin'] })
      onDone(r.advice ?? null)
    },
  })
  const toggle = (code: string) => {
    setNoFlags(false)
    setFlags(flags.includes(code) ? flags.filter((f) => f !== code) : [...flags, code])
  }

  return (
    <Card style={{ gap: 18 }}>
      <Text variant="eyebrow">Daily recovery check-in · 30 seconds</Text>
      <Scale label="Pain right now" low="No pain" high="Worst pain" value={pain} onChange={setPain} />
      <Scale label="Stiffness" low="None" high="Very stiff" value={stiffness} onChange={setStiffness} />
      <Choice label="Swelling" options={SWELLING} value={swelling} onChange={setSwelling} />
      <Choice label="How did you sleep?" options={SLEEP} value={sleep} onChange={setSleep} />
      <Choice label="Yesterday’s exercises done" options={EXERCISES} value={exercises} onChange={setExercises} />
      <View style={{ gap: 8 }}>
        <Text variant="heading">Since yesterday, have you had any of these?</Text>
        {state.red_flag_options.map((o) => (
          <Pressable key={o.code} accessibilityRole="checkbox" accessibilityState={{ checked: flags.includes(o.code) }} onPress={() => toggle(o.code)}
            style={{ borderWidth: 1, borderColor: flags.includes(o.code) ? colors.danger : colors.lineStrong, backgroundColor: flags.includes(o.code) ? colors.danger : colors.surface, borderRadius: radius.sm, padding: 12 }}>
            <Text style={{ color: flags.includes(o.code) ? '#fff' : colors.ink, fontFamily: font.medium }}>{o.label}</Text>
          </Pressable>
        ))}
        <Chip label="None of these" selected={noFlags} onPress={() => { setNoFlags(true); setFlags([]) }} />
      </View>
      {save.error && <ErrorText>{(save.error as Error).message}</ErrorText>}
      <Button title="Save check-in" onPress={() => save.mutate()} disabled={!ready} loading={save.isPending} />
      {onCancel && <Button title="Cancel" variant="ghost" onPress={onCancel} />}
    </Card>
  )
}

function Scale({ label, low, high, value, onChange }: { label: string; low: string; high: string; value: number | null; onChange: (v: number) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="heading">{label}{value != null ? ` · ${value}/10` : ''}</Text>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {Array.from({ length: 11 }, (_, i) => (
          <Pressable key={i} accessibilityRole="button" accessibilityLabel={`${i} out of 10`} accessibilityState={{ selected: value === i }} onPress={() => onChange(i)}
            style={{ flex: 1, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, borderWidth: 1,
              borderColor: value === i ? colors.ink : colors.lineStrong, backgroundColor: value === i ? colors.ink : colors.surface }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: value === i ? '#fff' : colors.ink }}>{i}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption">{low}</Text>
        <Text variant="caption">{high}</Text>
      </View>
    </View>
  )
}

function Choice<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { value: T; label: string }[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Text variant="heading">{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => <Chip key={o.value} label={o.label} selected={value === o.value} onPress={() => onChange(o.value)} />)}
      </View>
    </View>
  )
}

/** Opt in to (or out of) getting the daily check-in as a WhatsApp message each morning. */
function WhatsAppOptIn({ wa }: { wa: NonNullable<State['whatsapp']> }) {
  const qc = useQueryClient()
  const toggle = useMutation({
    mutationFn: () => wa.consent.granted
      ? api('/me/consents/whatsapp', { method: 'DELETE' })
      : api('/me/consents', { method: 'POST', json: { purpose: 'whatsapp', version: wa.consent.version } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checkin'] }),
  })
  return (
    <View style={{ marginTop: 8, gap: 6, backgroundColor: colors.surface2, borderRadius: radius.md, padding: 12 }}>
      {wa.consent.granted ? (
        <>
          <Text style={{ color: colors.ink, fontFamily: font.semibold }}>WhatsApp check-ins on · {wa.phone}</Text>
          <Text variant="caption">You’ll get a message each morning.</Text>
          <Pressable onPress={() => toggle.mutate()} accessibilityRole="button">
            <Text variant="caption" style={{ textDecorationLine: 'underline' }}>Turn off</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={{ color: colors.ink, fontFamily: font.semibold }}>{wa.consent.title}</Text>
          <Text variant="caption" style={{ lineHeight: 18 }}>{wa.consent.body}</Text>
          <Button title={`Turn on for ${wa.phone}`} variant="leaf" onPress={() => toggle.mutate()} loading={toggle.isPending} />
        </>
      )}
    </View>
  )
}
