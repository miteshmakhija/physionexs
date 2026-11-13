import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'

import { Button, Chip, ErrorText, Field, Loading, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { useClinic } from '@/lib/useClinic'
import { FORM_VERSION, needsScreening, type VisitType } from '@shared/assessment'
import { colors } from '@shared/tokens'

type YesNo = 'yes' | 'no'
type RedFlagAction = 'referred' | 'medical_review'

/** Quick SOAP note from the phone, with the mandatory red-flag screening. The full assessment lives in the web console. */
export default function Consult() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { clinicId } = useClinic()
  const qc = useQueryClient()
  const file = useQuery({ queryKey: ['patient-file', id], queryFn: () => api<Schemas['PatientFileOut']>(`/clinic/patients/${id}`, { clinicId }) })
  const formDef = useQuery({ queryKey: ['assessment-form'], queryFn: () => api<Schemas['AssessmentFormOut']>('/clinic/assessment-form', { clinicId }), staleTime: Infinity })

  if (file.isLoading || formDef.isLoading) return <Loading />
  if (!file.data || !formDef.data) return <View style={{ padding: 20 }}><ErrorText>Couldn’t load this patient. Go back and try again.</ErrorText></View>
  return <NoteForm id={id} clinicId={clinicId} firstVisit={file.data.consultations.length === 0} formDef={formDef.data}
    onSaved={() => { void qc.invalidateQueries({ queryKey: ['patient-file', id] }); router.back() }} />
}

function NoteForm({ id, clinicId, firstVisit, formDef, onSaved }: { id: string; clinicId: string; firstVisit: boolean; formDef: Schemas['AssessmentFormOut']; onSaved: () => void }) {
  const [visitType, setVisitType] = useState<VisitType>(firstVisit ? 'initial' : 'follow_up')
  const [flags, setFlags] = useState<Record<string, YesNo>>({})
  const [action, setAction] = useState<RedFlagAction | null>(null)
  const [soap, setSoap] = useState({ subjective: '', objective: '', assessment: '', plan: '' })
  const [pain, setPain] = useState<number | null>(null)
  const screening = needsScreening(visitType)
  const unanswered = formDef.red_flags.filter((f) => !flags[f.code]).length
  const positive = formDef.red_flags.filter((f) => flags[f.code] === 'yes')
  const signBlock = !screening ? null
    : unanswered ? `Answer all red-flag questions to sign (${unanswered} left).`
    : positive.length && !action ? 'Record the referral or medical review to sign.'
    : null

  const save = useMutation({
    mutationFn: (sign: boolean) => api<Schemas['ConsultationOut']>(`/clinic/patients/${id}/consultations`, {
      method: 'POST', clinicId,
      json: {
        ...soap, pain_vas: pain, sign,
        assessment_form: { version: FORM_VERSION, visit_type: visitType, red_flags: flags, red_flag_action: positive.length ? action : null, sections: {} },
      },
    }),
    onSuccess: onSaved,
  })
  const set = (k: keyof typeof soap) => (v: string) => setSoap({ ...soap, [k]: v })
  const tall = { height: 80, textAlignVertical: 'top' as const, paddingTop: 12 }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Text variant="label">Assessment type</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {formDef.visit_types.map((v) => <Chip key={v.code} label={v.label} selected={visitType === v.code} onPress={() => setVisitType(v.code as VisitType)} />)}
        </View>

        {screening && (
          <View style={{ borderWidth: 1, borderColor: positive.length ? colors.danger : colors.line, padding: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="label">Red-flag screening · required</Text>
              {unanswered > 0 && (
                <Chip label="Rest No" onPress={() => setFlags(Object.fromEntries(formDef.red_flags.map((f) => [f.code, flags[f.code] ?? 'no'])))} />
              )}
            </View>
            {formDef.red_flags.map((f) => (
              <View key={f.code} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ flex: 1, color: flags[f.code] === 'yes' ? colors.danger : colors.ink }}>{f.label}</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {(['yes', 'no'] as const).map((a) => <Chip key={a} label={a === 'yes' ? 'Yes' : 'No'} selected={flags[f.code] === a} onPress={() => setFlags({ ...flags, [f.code]: a })} />)}
                </View>
              </View>
            ))}
            {unanswered === 0 && positive.length === 0 && <Text style={{ color: colors.leafDark }}>No red flags identified.</Text>}
            {positive.length > 0 && (
              <>
                <Text style={{ color: colors.danger }}>Red flag identified. Referral or medical review is required.</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {formDef.red_flag_actions.map((a) => <Chip key={a.code} label={a.label} selected={action === a.code} onPress={() => setAction(a.code as RedFlagAction)} />)}
                </View>
              </>
            )}
          </View>
        )}

        <Field label="S — Subjective" value={soap.subjective} onChangeText={set('subjective')} multiline style={tall} />
        <Field label="O — Objective" value={soap.objective} onChangeText={set('objective')} multiline style={tall} />
        <Field label="A — Assessment" value={soap.assessment} onChangeText={set('assessment')} />
        <Field label="P — Plan" value={soap.plan} onChangeText={set('plan')} multiline style={tall} />
        <Text variant="label">Pain (VAS)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {Array.from({ length: 11 }, (_, n) => <Chip key={n} label={String(n)} selected={pain === n} onPress={() => setPain(n)} />)}
        </View>
        {save.error && <ErrorText>{(save.error as Error).message}</ErrorText>}
        {signBlock && <Text style={{ color: colors.danger }}>{signBlock}</Text>}
        <Button title="Save & sign" onPress={() => save.mutate(true)} disabled={!!signBlock} loading={save.isPending && save.variables === true} />
        <Button variant="ghost" title="Save draft" onPress={() => save.mutate(false)} loading={save.isPending && save.variables === false} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
