import { useMutation, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'

import { Button, Chip, ErrorText, Field, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { useClinic } from '@/lib/useClinic'
import { colors } from '@shared/tokens'

/** Quick SOAP note from the phone. Longer notes and prescribing live in the web console. */
export default function Consult() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { clinicId } = useClinic()
  const qc = useQueryClient()
  const [soap, setSoap] = useState({ subjective: '', objective: '', assessment: '', plan: '' })
  const [pain, setPain] = useState<number | null>(null)
  const save = useMutation({
    mutationFn: (sign: boolean) =>
      api<Schemas['ConsultationOut']>(`/clinic/patients/${id}/consultations`, { method: 'POST', clinicId, json: { ...soap, pain_vas: pain, sign } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['patient-file', id] })
      router.back()
    },
  })
  const set = (k: keyof typeof soap) => (v: string) => setSoap({ ...soap, [k]: v })

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Field label="S — Subjective" value={soap.subjective} onChangeText={set('subjective')} multiline style={{ height: 80, textAlignVertical: 'top', paddingTop: 12 }} />
        <Field label="O — Objective" value={soap.objective} onChangeText={set('objective')} multiline style={{ height: 80, textAlignVertical: 'top', paddingTop: 12 }} />
        <Field label="A — Assessment" value={soap.assessment} onChangeText={set('assessment')} />
        <Field label="P — Plan" value={soap.plan} onChangeText={set('plan')} multiline style={{ height: 80, textAlignVertical: 'top', paddingTop: 12 }} />
        <Text variant="label">Pain (VAS)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {Array.from({ length: 11 }, (_, n) => <Chip key={n} label={String(n)} selected={pain === n} onPress={() => setPain(n)} />)}
        </View>
        {save.error && <ErrorText>{(save.error as Error).message}</ErrorText>}
        <Button title="Save & sign" onPress={() => save.mutate(true)} loading={save.isPending && save.variables === true} />
        <Button variant="ghost" title="Save draft" onPress={() => save.mutate(false)} loading={save.isPending && save.variables === false} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
