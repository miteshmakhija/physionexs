import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import { Avatar, Spinner } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { rupees, when } from '@shared/format'

export default function PhysioProfile() {
  const { id } = useParams()
  const q = useQuery({ queryKey: ['physio', id], queryFn: () => api<Schemas['PhysioDetail']>(`/physios/${id}`) })

  if (q.isLoading) return <div className="grid place-items-center py-20 text-muted"><Spinner /></div>
  if (q.isError || !q.data) return <p className="py-10 text-danger">{(q.error as Error)?.message ?? 'Not found'}</p>
  const p = q.data

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
      <div>
        <Link to="/app/find" className="eyebrow hover:underline">← Find a physio</Link>
        <div className="mt-6 flex items-start gap-5">
          <Avatar name={p.full_name} className="size-16 text-[18px]" />
          <div>
            <h1 className="text-[28px] font-bold tracking-[-0.02em]">{p.full_name}</h1>
            <p className="text-[14px] text-muted">{p.qualification}</p>
            <p className="mt-1 text-[13.5px]">
              {p.reviews_count > 0 ? `★ ${p.rating_avg.toFixed(1)} · ${p.reviews_count} reviews` : 'New on Physionexs'}
            </p>
          </div>
        </div>

        {p.bio && (
          <Section title="About">
            <p className="text-[15px] leading-relaxed text-ink-2">{p.bio}</p>
          </Section>
        )}
        <Section title="Details">
          <dl className="grid gap-x-8 gap-y-4 text-[14px] sm:grid-cols-2">
            {p.college && <Item label="Educated at" value={p.college} />}
            {p.experience_years != null && <Item label="Experience" value={`${p.experience_years} years`} />}
            {p.specializations.length > 0 && <Item label="Specializations" value={p.specializations.join(', ')} />}
            {p.languages.length > 0 && <Item label="Languages" value={p.languages.join(', ')} />}
          </dl>
        </Section>
        <Section title="Clinic">
          {p.branches.map((b) => (
            <p key={b.id} className="text-[14px]">
              <span className="font-semibold">{p.clinic_name}</span> — {b.name}
              <span className="block text-muted">{[b.address, b.area, b.city].filter(Boolean).join(', ')}</span>
            </p>
          ))}
        </Section>
        <Section title={`Reviews${p.reviews.length ? ` (${p.reviews_count})` : ''}`}>
          {p.reviews.length === 0 ? (
            <p className="text-[14px] text-muted">No reviews yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {p.reviews.map((r, i) => (
                <li key={i} className="py-4 text-[14px]">
                  <p>
                    <span className="font-semibold">{'★'.repeat(r.rating)}</span>{' '}
                    <span className="text-muted">· {r.patient_name}</span>
                  </p>
                  {r.comment && <p className="mt-1 text-ink-2">{r.comment}</p>}
                  {r.tags.length > 0 && <p className="mt-1 text-[12.5px] text-muted">{r.tags.join(' · ')}</p>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="border border-line p-6">
          <p className="eyebrow">Consultation charges</p>
          <dl className="mt-4 space-y-3 text-[14px]">
            {p.offers_in_clinic && <Fee label="In-clinic visit" value={rupees(p.fee_in_clinic_paise)} />}
            {p.offers_online && <Fee label="Online video" value={rupees(p.fee_online_paise)} />}
          </dl>
          {p.next_slot_at && <p className="mt-5 text-[13px] text-muted">Next available: {when(p.next_slot_at)}</p>}
          <Link
            to={`/app/book/${p.id}`}
            className="mt-5 flex h-11 items-center justify-center rounded-md bg-ink text-[12.5px] font-semibold uppercase tracking-[0.09em] text-white hover:bg-ink-2"
          >
            Book appointment
          </Link>
        </div>
      </aside>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="eyebrow mb-4">{title}</h2>
      {children}
    </section>
  )
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  )
}

function Fee({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-line pb-3 last:border-0 last:pb-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  )
}
