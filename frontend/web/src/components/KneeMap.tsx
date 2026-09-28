import { cx } from '@/components/ui'

/** Front view, so the patient's right knee is on the viewer's left. */
export function KneeMap({ measures, className = 'hidden md:block' }: { measures: { side: string; status: string }[]; className?: string }) {
  const tone = (side: 'left' | 'right') => {
    const m = measures.find((x) => x.side === side)
    if (!m) return null
    return m.status === 'target_met' ? 'fill-leaf' : m.status === 'no_data' ? 'fill-line-strong' : 'fill-brand'
  }
  const knees = [{ side: 'right' as const, x: 62 }, { side: 'left' as const, x: 98 }]
  return (
    <figure className={className}>
      <svg viewBox="0 0 160 250" className="h-56 w-auto" role="img" aria-label="Body map: tracked knees are highlighted">
        <g className="stroke-line-strong" strokeWidth="3" strokeLinecap="round" fill="none">
          <circle cx="80" cy="24" r="14" />
          <path d="M80 40V118M56 54H104M56 54L48 96L46 134M104 54L112 96L114 134M66 118H94M66 118L62 178L60 238M94 118L98 178L100 238" />
        </g>
        {knees.map(({ side, x }) => {
          const cls = tone(side)
          return cls ? (
            <g key={side}>
              <circle cx={x} cy="178" r="11" className={cx(cls, 'opacity-20')} />
              <circle cx={x} cy="178" r="5.5" className={cls} />
            </g>
          ) : <circle key={side} cx={x} cy="178" r="4" strokeWidth="2" className="fill-surface stroke-line-strong" />
        })}
      </svg>
      <figcaption className="mt-1 text-center text-[11.5px] text-muted">R · L</figcaption>
    </figure>
  )
}
