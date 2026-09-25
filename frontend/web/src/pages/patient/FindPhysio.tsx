import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'

import { PageHeader } from '@/components/ConsoleLayout'
import { Avatar, Button, cx, Input, Spinner } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { rupees, when } from '@shared/format'

type Mode = '' | 'online' | 'in_clinic'

export default function FindPhysio() {
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState(params.get('q') ?? '')
  const [cityText, setCityText] = useState(params.get('city') ?? '')
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)

  const q = params.get('q') ?? ''
  const city = params.get('city') ?? ''
  const mode = (params.get('mode') ?? '') as Mode
  const minRating = params.get('min_rating') ?? ''
  const radius = params.get('radius_km') ?? '10'

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const results = useQuery({
    queryKey: ['physios', q, city, mode, minRating, geo, radius],
    queryFn: () =>
      api<Schemas['DirectoryPage']>('/physios', {
        query: { q, city: geo ? undefined : city, mode, min_rating: minRating, lat: geo?.lat, lng: geo?.lng, radius_km: geo ? radius : undefined },
      }),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next = new URLSearchParams(params)
    for (const [key, value] of [['q', text], ['city', cityText]]) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }

  const locate = () => {
    if (geo) return setGeo(null)
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocating(false)
      },
      () => setLocating(false),
      { timeout: 10_000 },
    )
  }

  return (
    <div>
      <PageHeader title="Find a physio" subtitle="Search physios, clinics and specialities." />

      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_220px_auto]">
        <Input placeholder="Knee, back pain, sports injury…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search" />
        <Input placeholder="City" value={cityText} onChange={(e) => setCityText(e.target.value)} aria-label="City" disabled={!!geo} />
        <Button type="submit">Search</Button>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line pb-4">
        <FilterGroup
          label="Mode"
          value={mode}
          onChange={(v) => set('mode', v)}
          options={[
            { value: '', label: 'All' },
            { value: 'online', label: 'Online' },
            { value: 'in_clinic', label: 'In-clinic' },
          ]}
        />
        <FilterGroup
          label="Rating"
          value={minRating}
          onChange={(v) => set('min_rating', v)}
          options={[
            { value: '', label: 'Any' },
            { value: '4.5', label: '★ 4.5+' },
            { value: '4.8', label: '★ 4.8+' },
          ]}
        />
        <div className="flex items-center gap-2">
          <button type="button" onClick={locate} className={cx('eyebrow underline-offset-4 hover:underline', geo && '!text-ink')}>
            {locating ? 'Locating…' : geo ? '✓ Near me' : 'Use my location'}
          </button>
          {geo && (
            <select
              value={radius}
              onChange={(e) => set('radius_km', e.target.value)}
              className="h-8 rounded-sm border border-line-strong bg-surface px-2 text-[13px]"
              aria-label="Distance radius"
            >
              {['5', '10', '25', '50'].map((r) => (
                <option key={r} value={r}>
                  within {r} km
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {results.isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner />
        </div>
      ) : results.isError ? (
        <p className="py-10 text-[14px] text-danger">{(results.error as Error).message}</p>
      ) : (
        <>
          <p className="eyebrow mt-5">
            {results.data!.total} physio{results.data!.total === 1 ? '' : 's'} {geo ? 'near you · nearest first' : city ? `in ${city}` : ''}
          </p>
          {results.data!.items.length === 0 ? (
            <p className="py-10 text-[14px] text-muted">No physiotherapists match. Try a different city or fewer filters.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {results.data!.items.map((p) => (
                <li key={p.id}>
                  <PhysioRow p={p} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function PhysioRow({ p }: { p: Schemas['PhysioCard'] }) {
  const fee = p.offers_in_clinic ? p.fee_in_clinic_paise : p.fee_online_paise
  return (
    <Link to={`/app/physios/${p.id}`} className="flex gap-4 py-5 transition hover:bg-surface-2 sm:px-3">
      <Avatar name={p.full_name} className="size-12 text-[14px]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h3 className="text-[16px] font-semibold">{p.full_name}</h3>
          <span className="text-[13px] text-ink">
            {p.reviews_count > 0 ? `★ ${p.rating_avg.toFixed(1)} (${p.reviews_count})` : 'New'}
          </span>
        </div>
        <p className="text-[13px] text-muted">
          {[p.qualification, p.experience_years ? `${p.experience_years} yrs exp` : null, p.clinic_name].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-2 text-[13px] text-ink-2">{p.specializations.join(' · ')}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
          <span>
            {p.branch.area ? `${p.branch.area}, ` : ''}
            {p.branch.city}
            {p.distance_km != null && ` · ${p.distance_km} km`}
          </span>
          <span>{[p.offers_in_clinic && 'In-clinic', p.offers_online && 'Online'].filter(Boolean).join(' & ')}</span>
          <span>From {rupees(fee)}</span>
          {p.next_slot_at && <span className="text-leaf-dark">Next: {when(p.next_slot_at)}</span>}
        </div>
      </div>
    </Link>
  )
}

function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow">{label}</span>
      <div className="flex">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={cx(
              '-ml-px h-8 border px-3 text-[12.5px] first:ml-0 first:rounded-l-sm last:rounded-r-sm',
              value === o.value ? 'relative z-10 border-ink bg-ink text-white' : 'border-line-strong text-ink-2 hover:bg-surface-2',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
