import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Alert, Button, cx, Textarea } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'

const TAGS = ['Very caring', 'Explained clearly', 'On time', 'Clean clinic', 'Effective treatment', 'Good follow-up']
const LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']

/** Star rating + tags + comment for a completed appointment. */
export function RateVisit({ appointment }: { appointment: Schemas['AppointmentOut'] }) {
  const qc = useQueryClient()
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
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
      <div className="border border-line p-5 text-[14px]">
        <p className="font-semibold">Thank you for your feedback</p>
        <p className="mt-1 text-muted">{'★'.repeat(appointment.review.rating)} · shared with {appointment.physio.full_name} and added to their profile.</p>
      </div>
    )
  }
  const shown = hover || rating
  return (
    <div className="border border-line p-5">
      <p className="text-[15px] font-semibold">How was your session?</p>
      <p className="text-[13px] text-muted">Your rating helps other patients choose the right physio.</p>
      <div className="mt-3 flex items-center gap-1" onMouseLeave={() => setHover(0)} role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => setRating(n)}
            className={cx('text-[30px] leading-none transition', n <= shown ? 'text-ink' : 'text-line-strong')}
          >
            ★
          </button>
        ))}
        <span className="ml-3 text-[13px] text-muted">{LABELS[shown]}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {TAGS.map((t) => (
          <button key={t} type="button" onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}
            className={cx('h-8 border px-3 text-[12.5px]', tags.includes(t) ? 'border-ink bg-ink text-white' : 'border-line-strong hover:border-ink')}>
            {t}
          </button>
        ))}
      </div>
      <Textarea className="mt-3" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment (optional)" maxLength={1000} />
      {submit.error && <div className="mt-3"><Alert>{(submit.error as Error).message}</Alert></div>}
      <Button className="mt-3" disabled={!rating} loading={submit.isPending} onClick={() => submit.mutate()}>Submit feedback</Button>
    </div>
  )
}
