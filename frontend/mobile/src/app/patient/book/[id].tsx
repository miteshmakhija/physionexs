import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Switch, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button, Chip, Divider, ErrorText, Loading, Row, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { payWithRazorpay } from '@/lib/payments'
import { dayParts, hourIn, MODE_LABEL, REFERRAL_OPTIONS, rupees, time, when } from '@shared/format'
import { colors, font, radius } from '@shared/tokens'

type Mode = 'in_clinic' | 'online'
type Pay = 'clinic' | 'online'

export default function Book() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const qc = useQueryClient()
  const physio = useQuery({ queryKey: ['physio', id], queryFn: () => api<Schemas['PhysioDetail']>(`/physios/${id}`) })
  const branches = physio.data?.branches ?? []
  const [branchId, setBranchId] = useState<string | null>(null)
  // One branch: it's chosen for them. Several: the patient picks before seeing that branch's slots.
  const branch = branches.length === 1 ? branches[0].id : branchId
  const days = useQuery({
    queryKey: ['slots', id, branch],
    queryFn: () => api<Schemas['DayOut'][]>(`/physios/${id}/slots`, { query: { days: 7, branch_id: branch ?? undefined } }),
    enabled: !!physio.data && (branches.length <= 1 || !!branch),
  })
  const points = useQuery({ queryKey: ['points'], queryFn: () => api<Schemas['PointsOut']>('/me/points') })
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api<Schemas['AuthConfigOut']>('/platform/auth-config') })
  const onlinePayments = config.data?.online_payments ?? false

  const [dayIdx, setDayIdx] = useState<number | null>(null)
  const [slot, setSlot] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [referral, setReferral] = useState<string | null>(null)
  const [redeem, setRedeem] = useState(false)
  const [pay, setPay] = useState<Pay | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const p = physio.data
  const effectiveMode: Mode = mode ?? (p?.offers_in_clinic ? 'in_clinic' : 'online')
  // Online consults are paid in advance; in-clinic visits can be paid at the desk (the only way until Razorpay is live).
  const effectivePay: Pay = effectiveMode === 'online' ? 'online' : pay ?? (onlinePayments ? 'online' : 'clinic')
  const payAtClinic = effectivePay === 'clinic'
  const firstOpen = days.data?.findIndex((d) => d.slots.some((s) => s.available)) ?? -1
  const activeDay = dayIdx ?? Math.max(firstOpen, 0)

  const groups = useMemo(() => {
    const g: Record<string, Schemas['SlotOut'][]> = { Morning: [], Afternoon: [], Evening: [] }
    for (const s of days.data?.[activeDay]?.slots ?? []) {
      const h = hourIn(s.starts_at)
      g[h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'].push(s)
    }
    return Object.entries(g).filter(([, v]) => v.length)
  }, [days.data, activeDay])

  if (physio.isLoading || (days.isLoading && days.fetchStatus !== 'idle')) return <Loading />
  if (!p) return <Text style={{ padding: 20 }}>Physiotherapist not found.</Text>

  const fee = (effectiveMode === 'online' ? p.fee_online_paise : p.fee_in_clinic_paise) ?? 0
  const ppp = points.data?.paise_per_point ?? 100
  const pointsValue = Math.min(points.data?.balance ?? 0, Math.floor(fee / ppp)) * ppp
  const payable = fee - (redeem && !payAtClinic ? pointsValue : 0)
  const n = (k: number) => (branches.length > 1 ? k + 1 : k)

  const confirm = async () => {
    if (!slot) return
    setBusy(true)
    setError(null)
    try {
      const checkout = await api<Schemas['CheckoutOut']>('/bookings', {
        method: 'POST',
        json: {
          physio_id: p.id, starts_at: slot, mode: effectiveMode, branch_id: branch, referral_source: referral,
          redeem_points: redeem && !payAtClinic, pay_at_clinic: payAtClinic,
        },
      })
      if (checkout.razorpay) {
        const result = await payWithRazorpay(checkout.razorpay)
        if (!result) {
          setError('Payment was not completed. Your slot is held for 15 minutes — tap pay again to confirm it.')
          return
        }
        await api(`/bookings/${checkout.appointment_id}/verify`, { method: 'POST', json: result })
      }
      await Promise.all(['my-appointments', 'points', 'slots'].map((key) => qc.invalidateQueries({ queryKey: [key] })))
      router.dismissTo({ pathname: '/patient/appointment/[id]', params: { id: checkout.appointment_id, booked: '1' } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      void days.refetch()
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }}>
        <Text variant="heading">{p.full_name}</Text>

        {branches.length > 1 && (
          <>
            <Text variant="eyebrow">1. Choose the clinic branch</Text>
            <View style={{ gap: 8 }}>
              {branches.map((b) => (
                <Pressable
                  key={b.id}
                  onPress={() => {
                    setBranchId(b.id)
                    setDayIdx(null)
                    setSlot(null)
                  }}
                  style={{ padding: 14, borderWidth: 1, borderRadius: radius.md, borderColor: branch === b.id ? colors.ink : colors.lineStrong, gap: 2 }}
                >
                  <Text style={{ fontFamily: font.semibold, color: colors.ink }}>{b.name}</Text>
                  <Text variant="caption">{[b.area, b.city].filter(Boolean).join(', ')}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {(branches.length <= 1 || !!branch) && (<>
        <Text variant="eyebrow">{n(1)}. Select date</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {(days.data ?? []).map((d, i) => {
            const open = d.slots.some((s) => s.available)
            const parts = dayParts(d.date)
            const selected = i === activeDay
            return (
              <Pressable
                key={d.date}
                disabled={!open}
                onPress={() => {
                  setDayIdx(i)
                  setSlot(null)
                }}
                style={{
                  width: 58,
                  paddingVertical: 10,
                  alignItems: 'center',
                  borderWidth: 1,
                  borderRadius: radius.sm,
                  borderColor: selected ? colors.ink : colors.lineStrong,
                  backgroundColor: selected ? colors.ink : colors.surface,
                  opacity: open ? 1 : 0.35,
                }}
              >
                <Text variant="eyebrow" style={{ color: selected ? 'rgba(255,255,255,0.7)' : colors.muted }}>{parts.weekday}</Text>
                <Text style={{ fontFamily: font.semibold, fontSize: 18, color: selected ? '#fff' : colors.ink }}>{parts.date}</Text>
              </Pressable>
            )
          })}
        </ScrollView>

        <Text variant="eyebrow">{n(2)}. Available slots</Text>
        {groups.length === 0 ? (
          <Text>No slots on this day.</Text>
        ) : (
          groups.map(([label, slots]) => (
            <View key={label} style={{ gap: 8 }}>
              <Text variant="caption">{label}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {slots.map((s) => (
                  <Chip key={s.starts_at} label={time(s.starts_at)} selected={slot === s.starts_at} disabled={!s.available} strike={!s.available} onPress={() => setSlot(s.starts_at)} />
                ))}
              </View>
            </View>
          ))
        )}

        <Text variant="eyebrow">{n(3)}. How would you like to consult?</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['in_clinic', 'online'] as const).map((m) => {
            // Online consults need online payment, which isn't live yet.
            const offered = m === 'online' ? p.offers_online && onlinePayments : p.offers_in_clinic
            const price = m === 'online' ? p.fee_online_paise : p.fee_in_clinic_paise
            return (
              <Pressable
                key={m}
                disabled={!offered}
                onPress={() => setMode(m)}
                style={{
                  flex: 1,
                  padding: 14,
                  borderWidth: 1,
                  borderRadius: radius.md,
                  borderColor: effectiveMode === m ? colors.ink : colors.lineStrong,
                  opacity: offered ? 1 : 0.4,
                  gap: 2,
                }}
              >
                <Text style={{ fontFamily: font.semibold, color: colors.ink }}>{MODE_LABEL[m]}</Text>
                <Text variant="caption">{offered ? rupees(price) : m === 'online' && p.offers_online ? 'Coming soon' : 'Not offered'}</Text>
              </Pressable>
            )
          })}
        </View>

        <Text variant="eyebrow">{n(4)}. How would you like to pay?</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['clinic', 'online'] as const).map((opt) => {
            const available = opt === 'clinic' ? effectiveMode === 'in_clinic' : onlinePayments
            return (
              <Pressable
                key={opt}
                disabled={!available}
                onPress={() => setPay(opt)}
                style={{ flex: 1, padding: 14, borderWidth: 1, borderRadius: radius.md, borderColor: effectivePay === opt ? colors.ink : colors.lineStrong, opacity: available ? 1 : 0.4, gap: 2 }}
              >
                <Text style={{ fontFamily: font.semibold, color: colors.ink }}>{opt === 'clinic' ? 'Pay at the clinic' : 'Pay online now'}</Text>
                <Text variant="caption">
                  {opt === 'clinic' ? (effectiveMode === 'online' ? 'Only for in-clinic visits' : 'Cash, UPI or card at reception') : onlinePayments ? 'UPI, cards, net banking' : 'Coming soon'}
                </Text>
              </Pressable>
            )
          })}
        </View>

        <Text variant="eyebrow">{n(5)}. How did you find {p.full_name}?</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {REFERRAL_OPTIONS.map((o) => (
            <Chip key={o.value} label={o.label} selected={referral === o.value} onPress={() => setReferral(referral === o.value ? null : o.value)} />
          ))}
        </View>

        </>)}

        <Divider />
        <View>
          {branch && <Row label="Branch" value={branches.find((b) => b.id === branch)?.name ?? '—'} />}
          <Row label="Date & time" value={slot ? when(slot) : '—'} />
          <Row label="Mode" value={MODE_LABEL[effectiveMode]} />
          <Row label="Consultation fee" value={rupees(fee)} />
          {redeem && pointsValue > 0 && <Row label="Points redeemed" value={`− ${rupees(pointsValue)}`} />}
        </View>
        {points.data && points.data.balance > 0 && !payAtClinic && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontFamily: font.medium }}>Redeem {rupees(pointsValue)} in points</Text>
              <Text variant="caption">Use your {points.data.balance} Health Points</Text>
            </View>
            <Switch value={redeem} onValueChange={setRedeem} trackColor={{ true: colors.ink }} />
          </View>
        )}
        {error && <ErrorText>{error}</ErrorText>}
      </ScrollView>
      <View style={{ padding: 16, gap: 6, borderTopWidth: 1, borderTopColor: colors.line }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text variant="eyebrow">{payAtClinic ? 'Pay at the clinic' : 'Total payable'}</Text>
          <Text style={{ fontFamily: font.bold, fontSize: 22, color: colors.ink }}>{rupees(payable)}</Text>
        </View>
        <Button title={payAtClinic || payable === 0 ? 'Confirm booking' : `Confirm & pay ${rupees(payable)}`} onPress={confirm} loading={busy} disabled={!slot} />
        {payAtClinic && <Text variant="caption" style={{ textAlign: 'center' }}>Your slot is confirmed now. Pay at reception when you visit.</Text>}
      </View>
    </SafeAreaView>
  )
}
