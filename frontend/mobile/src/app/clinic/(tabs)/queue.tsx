import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Avatar, Button, Card, Chip, Divider, ErrorText, Field, Loading, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { useClinic } from '@/lib/useClinic'
import { time } from '@shared/format'
import { colors, font } from '@shared/tokens'

type Queue = Schemas['QueueOut']
type Token = Schemas['QueueTokenOut']

export default function QueueTab() {
  const { clinicId } = useClinic()
  const qc = useQueryClient()
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Schemas['BranchOut'][]>('/clinic/branches', { clinicId }) })
  const [picked, setPicked] = useState('')
  const branchId = picked || branches.data?.[0]?.id || ''
  const [adding, setAdding] = useState(false)

  const queue = useQuery({
    queryKey: ['queue', branchId],
    queryFn: () => api<Queue>('/clinic/queue', { clinicId, query: { branch_id: branchId } }),
    enabled: !!branchId,
    refetchInterval: 10_000,
  })
  const callNext = useMutation({
    mutationFn: () => api<Queue>('/clinic/queue/call-next', { method: 'POST', clinicId, query: { branch_id: branchId } }),
    onSuccess: (q) => qc.setQueryData(['queue', branchId], q),
  })
  const q = queue.data
  const next = q?.waiting[0]

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} refreshControl={<RefreshControl refreshing={queue.isRefetching} onRefresh={() => void queue.refetch()} />}>
        <Text variant="title">Token queue</Text>
        {(branches.data?.length ?? 0) > 1 && (
          <ScrollView horizontal contentContainerStyle={{ gap: 8 }} showsHorizontalScrollIndicator={false}>
            {branches.data!.map((b) => <Chip key={b.id} label={b.name} selected={b.id === branchId} onPress={() => setPicked(b.id)} />)}
          </ScrollView>
        )}
        {!q ? <Loading /> : (
          <>
            <Card style={{ backgroundColor: colors.ink, borderColor: colors.ink, gap: 6 }}>
              <Text variant="eyebrow" style={{ color: 'rgba(255,255,255,0.6)' }}>Now serving · {q.waiting.length} waiting</Text>
              {q.now_serving ? (
                <>
                  <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: 34 }}>{q.now_serving.label}</Text>
                  <Text style={{ color: '#fff' }}>{q.now_serving.patient_name}{q.now_serving.reason ? ` · ${q.now_serving.reason}` : ''}</Text>
                </>
              ) : <Text style={{ color: 'rgba(255,255,255,0.7)' }}>Nobody yet</Text>}
              <View style={{ marginTop: 10 }}>
                <Pressable
                  onPress={() => callNext.mutate()}
                  disabled={callNext.isPending || (!next && !q.now_serving)}
                  style={{ borderWidth: 1, borderColor: '#fff', borderRadius: 4, height: 46, alignItems: 'center', justifyContent: 'center', opacity: callNext.isPending ? 0.6 : 1 }}
                >
                  <Text variant="eyebrow" style={{ color: '#fff' }}>{next ? `Call next · ${next.label}` : 'Finish current'}</Text>
                </Pressable>
              </View>
            </Card>

            {adding ? (
              <WalkInForm branchId={branchId} clinicId={clinicId} onDone={() => { setAdding(false); void qc.invalidateQueries({ queryKey: ['queue', branchId] }) }} />
            ) : (
              <Button variant="ghost" title="+ Register walk-in" onPress={() => setAdding(true)} />
            )}

            <Text variant="eyebrow">Waiting</Text>
            {q.waiting.length === 0 ? <Text>No one waiting.</Text> : (
              <Card style={{ padding: 0 }}>
                {q.waiting.map((t, i) => (
                  <View key={t.id}>
                    {i > 0 && <Divider />}
                    <TokenRow t={t} />
                  </View>
                ))}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function TokenRow({ t }: { t: Token }) {
  return (
    <Pressable
      onPress={() => t.clinic_patient_id && router.push({ pathname: '/clinic/patient/[id]', params: { id: t.clinic_patient_id } })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}
    >
      <Text style={{ width: 48, fontFamily: font.bold, color: colors.ink }}>{t.label}</Text>
      <Avatar name={t.patient_name} size={34} />
      <View style={{ flex: 1 }}>
        <Text variant="heading">{t.patient_name}{t.patient_age != null ? ` · ${t.patient_age}` : ''}</Text>
        <Text variant="caption">{t.reason ?? 'Walk-in'} · {time(t.created_at)}</Text>
      </View>
    </Pressable>
  )
}

function WalkInForm({ branchId, clinicId, onDone }: { branchId: string; clinicId: string; onDone: () => void }) {
  const [f, setF] = useState({ phone: '', full_name: '', age: '', reason: '' })
  const register = useMutation({
    mutationFn: () =>
      api<Token>('/clinic/queue', {
        method: 'POST',
        clinicId,
        json: { branch_id: branchId, phone: f.phone || null, full_name: f.full_name, age: f.age ? Number(f.age) : null, reason: f.reason || null },
      }),
    onSuccess: onDone,
  })
  return (
    <Card style={{ gap: 12 }}>
      <Text variant="heading">Register walk-in</Text>
      <Field label="Mobile" value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} keyboardType="phone-pad" hint="Existing patients are matched by number." />
      <Field label="Full name" value={f.full_name} onChangeText={(v) => setF({ ...f, full_name: v })} />
      <Field label="Age" value={f.age} onChangeText={(v) => setF({ ...f, age: v.replace(/\D/g, '') })} keyboardType="number-pad" />
      <Field label="Reason for visit" value={f.reason} onChangeText={(v) => setF({ ...f, reason: v })} />
      {register.error && <ErrorText>{(register.error as Error).message}</ErrorText>}
      <Button title="Issue token" onPress={() => register.mutate()} loading={register.isPending} disabled={f.full_name.trim().length < 2} />
    </Card>
  )
}
