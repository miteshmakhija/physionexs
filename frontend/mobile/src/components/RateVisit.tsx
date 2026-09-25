import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'

import { Button, Card, Chip, ErrorText, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { colors, font, radius } from '@shared/tokens'

const TAGS = ['Very caring', 'Explained clearly', 'On time', 'Clean clinic', 'Effective treatment', 'Good follow-up']

/** Star rating + tags + comment for a completed appointment. */
export function RateVisit({ appointment }: { appointment: Schemas['AppointmentOut'] }) {
  const qc = useQueryClient()
  const [rating, setRating] = useState(0)
  const [tags, setTags] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const submit = useMutation({
    mutationFn: () => api<Schemas['AppointmentOut']>(`/me/appointments/${appointment.id}/review`, { method: 'POST', json: { rating, tags, comment: comment || null } }),
    onSuccess: (a) => {
      qc.setQueryData(['appointment', appointment.id], a)
      void qc.invalidateQueries({ queryKey: ['my-appointments'] })
    },
  })

  if (appointment.review) {
    return (
      <Card style={{ gap: 4 }}>
        <Text variant="heading">Thank you for your feedback</Text>
        <Text>{'★'.repeat(appointment.review.rating)} · shared with {appointment.physio.full_name}</Text>
      </Card>
    )
  }
  return (
    <Card style={{ gap: 12 }}>
      <View>
        <Text variant="heading">How was your session?</Text>
        <Text variant="caption">Your rating helps other patients choose the right physio.</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setRating(n)} accessibilityRole="radio" accessibilityState={{ checked: rating === n }} accessibilityLabel={`${n} stars`} hitSlop={6}>
            <Text style={{ fontSize: 32, color: n <= rating ? colors.ink : colors.lineStrong }}>★</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {TAGS.map((t) => <Chip key={t} label={t} selected={tags.includes(t)} onPress={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])} />)}
      </View>
      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder="Add a comment (optional)"
        placeholderTextColor={colors.subtle}
        multiline
        maxLength={1000}
        style={{ minHeight: 70, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, padding: 12, fontFamily: font.regular, fontSize: 14, color: colors.ink, textAlignVertical: 'top' }}
      />
      {submit.error && <ErrorText>{(submit.error as Error).message}</ErrorText>}
      <Button title="Submit feedback" onPress={() => submit.mutate()} loading={submit.isPending} disabled={!rating} />
    </Card>
  )
}
