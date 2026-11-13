// Renders the structured assessment (frontend/shared/assessment.ts) one section at a time.
import type { ReactNode } from 'react'

import { Field, Input, Textarea } from '@/components/ui'
import {
  MATRIX_SIDES,
  SPECIAL_TESTS,
  TEST_RESULTS,
  degreeLabel,
  isVisible,
  rowsFor,
  type FormField,
  type FormSection,
  type GradeCell,
  type MatrixCell,
  type Option,
  type SectionValues,
} from '@shared/assessment'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export type Step = { id: string; title: string; required?: boolean; done: boolean; started: boolean }

/** Step chips: every step is reachable; a dot shows progress, a red ring a required step that isn't done. */
export function StepNav({ steps, current, onSelect }: { steps: Step[]; current: number; onSelect: (i: number) => void }) {
  return (
    <nav aria-label="Assessment sections" className="-mx-1 flex flex-wrap gap-1.5">
      {steps.map((s, i) => (
        <button key={s.id} type="button" onClick={() => onSelect(i)} aria-current={i === current ? 'step' : undefined}
          className={cx(
            'flex h-8 items-center gap-1.5 border px-2.5 text-[12px] font-semibold',
            i === current ? 'border-ink bg-ink text-white' : s.required && !s.done ? 'border-danger text-danger' : 'border-line-strong text-ink-2 hover:border-ink',
          )}>
          <span className={cx('size-1.5 rounded-full', s.done ? (i === current ? 'bg-white' : 'bg-leaf-dark') : s.started ? 'bg-amber' : 'bg-line-strong')} aria-hidden />
          {s.title}
        </button>
      ))}
    </nav>
  )
}

function Chips({ options, isOn, onToggle, label }: { options: readonly Option[]; isOn: (v: string) => boolean; onToggle: (v: string) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={isOn(o.value)} onClick={() => onToggle(o.value)}
          className={cx('min-h-8 border px-2.5 py-1 text-[13px]', isOn(o.value) ? 'border-ink bg-ink text-white' : 'border-line-strong text-ink-2 hover:border-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const YES_NO: Option[] = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]

/** One section's fields. `region` drives the movement rows and the special-test list. */
export function SectionForm({ section, values, onChange, region, note }: { section: FormSection; values: SectionValues; onChange: (v: SectionValues) => void; region?: string; note?: string }) {
  const set = (key: string, v: unknown) => onChange({ ...values, [key]: v })
  return (
    <div className="space-y-6">
      {section.hint && <p className="text-[13px] text-muted">{section.hint}</p>}
      {note && <p className="border-l-2 border-leaf-dark pl-3 text-[13px] text-ink-2">{note}</p>}
      {section.groups.map((g, gi) => {
        const fields = g.fields.filter((f) => isVisible(f, values))
        if (!fields.length) return null
        const yesno = fields.filter((f) => f.kind === 'yesno')
        const rest = fields.filter((f) => f.kind !== 'yesno')
        return (
          <div key={gi} className="space-y-4">
            {g.title && <p className="eyebrow">{g.title}</p>}
            {yesno.length > 0 && (
              <ul className="divide-y divide-line border-y border-line">
                {yesno.map((f) => (
                  <li key={f.key} className="flex items-center justify-between gap-3 py-1.5 text-[14px]">
                    <span>{f.label}</span>
                    <Chips label={f.label} options={YES_NO} isOn={(v) => values[f.key] === v} onToggle={(v) => set(f.key, values[f.key] === v ? undefined : v)} />
                  </li>
                ))}
              </ul>
            )}
            {rest.map((f) => <FieldInput key={f.key} field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} region={region} />)}
          </div>
        )
      })}
    </div>
  )
}

function FieldInput({ field: f, value, onChange, region }: { field: FormField; value: unknown; onChange: (v: unknown) => void; region?: string }) {
  const wrap = (body: ReactNode) => <Field label={f.label}>{body}</Field>
  switch (f.kind) {
    case 'single':
      return wrap(<Chips label={f.label} options={f.options} isOn={(v) => value === v} onToggle={(v) => onChange(value === v ? undefined : v)} />)
    case 'multi': {
      const list = (value as string[] | undefined) ?? []
      return wrap(<Chips label={f.label} options={f.options} isOn={(v) => list.includes(v)} onToggle={(v) => onChange(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])} />)
    }
    case 'select':
      return wrap(
        <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)}
          className="h-10 w-full max-w-sm rounded-md border border-line-strong bg-surface px-3 text-[14px]">
          <option value="">Select…</option>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>,
      )
    case 'yesno':
      return wrap(<Chips label={f.label} options={YES_NO} isOn={(v) => value === v} onToggle={(v) => onChange(value === v ? undefined : v)} />)
    case 'scale':
      return wrap(
        <Chips label={f.label} options={Array.from({ length: f.max - f.min + 1 }, (_, i) => ({ value: String(f.min + i), label: String(f.min + i) }))}
          isOn={(v) => value === Number(v)} onToggle={(v) => onChange(value === Number(v) ? undefined : Number(v))} />,
      )
    case 'text':
      return wrap(f.multiline
        ? <Textarea rows={3} value={(value as string) ?? ''} maxLength={2000} onChange={(e) => onChange(e.target.value)} />
        : <Input value={(value as string) ?? ''} maxLength={200} onChange={(e) => onChange(e.target.value)} className="!h-10 max-w-sm" />)
    case 'date':
      return wrap(<Input type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className="!h-10 max-w-[12rem]" />)
    case 'matrix':
      return wrap(<Matrix rows={rowsFor(f.rows, region)} columns={f.columns} sided={!!f.sided} value={(value as Record<string, MatrixCell>) ?? {}} onChange={onChange} />)
    case 'grades':
      return wrap(<Grades rows={rowsFor(f.rows, region)} min={f.min} max={f.max} value={(value as Record<string, GradeCell>) ?? {}} onChange={onChange} />)
    case 'degrees':
      return wrap(<Degrees rows={rowsFor(f.rows, region)} region={region} max={f.max} value={(value as Record<string, GradeCell>) ?? {}} onChange={onChange} />)
    case 'special_tests':
      return <SpecialTests region={region} value={(value as Record<string, string>) ?? {}} onChange={onChange} />
  }
}

function Matrix({ rows, columns, sided, value, onChange }: { rows: readonly Option[]; columns: readonly Option[]; sided: boolean; value: Record<string, MatrixCell>; onChange: (v: unknown) => void }) {
  const setCell = (row: string, patch: MatrixCell) => {
    const next = { ...value[row], ...patch }
    const rest = { ...value }
    delete rest[row]
    onChange(next.value || next.side ? { ...rest, [row]: next } : rest)
  }
  return (
    <ul className="divide-y divide-line border-y border-line">
      {rows.map((r) => (
        <li key={r.value} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[14px]">
          <span className="min-w-[8rem]">{r.label}</span>
          <span className="flex flex-wrap gap-3">
            <Chips label={r.label} options={columns} isOn={(v) => value[r.value]?.value === v} onToggle={(v) => setCell(r.value, { value: value[r.value]?.value === v ? undefined : v })} />
            {sided && <Chips label={`${r.label} side`} options={MATRIX_SIDES} isOn={(v) => value[r.value]?.side === v} onToggle={(v) => setCell(r.value, { side: value[r.value]?.side === v ? undefined : v })} />}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Grades({ rows, min, max, value, onChange }: { rows: readonly Option[]; min: number; max: number; value: Record<string, GradeCell>; onChange: (v: unknown) => void }) {
  const grades = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  const setGrade = (row: string, side: 'right' | 'left', g: number | undefined) => {
    const next: GradeCell = { ...value[row], [side]: g }
    const rest = { ...value }
    delete rest[row]
    onChange(next.right != null || next.left != null ? { ...rest, [row]: next } : rest)
  }
  return (
    <ul className="divide-y divide-line border-y border-line">
      {rows.map((r) => (
        <li key={r.value} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[14px]">
          <span className="min-w-[8rem]">{r.label}</span>
          <span className="flex flex-wrap gap-3">
            {(['right', 'left'] as const).map((side) => (
              <span key={side} className="flex items-center gap-1.5">
                <span className="w-3 text-[12px] font-semibold text-muted">{side === 'right' ? 'R' : 'L'}</span>
                <select aria-label={`${r.label} ${side}`} value={value[r.value]?.[side] ?? ''}
                  onChange={(e) => setGrade(r.value, side, e.target.value === '' ? undefined : Number(e.target.value))}
                  className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] tabular-nums">
                  <option value="">–</option>
                  {grades.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Degrees({ rows, region, max, value, onChange }: { rows: readonly Option[]; region?: string; max: number; value: Record<string, GradeCell>; onChange: (v: unknown) => void }) {
  const setDeg = (row: string, side: 'right' | 'left', raw: string) => {
    const n = raw === '' ? undefined : Math.max(0, Math.min(max, Math.round(Number(raw))))
    const next: GradeCell = { ...value[row], [side]: Number.isNaN(n) ? undefined : n }
    const rest = { ...value }
    delete rest[row]
    onChange(next.right != null || next.left != null ? { ...rest, [row]: next } : rest)
  }
  return (
    <ul className="divide-y divide-line border-y border-line">
      {rows.map((r) => (
        <li key={r.value} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[14px]">
          <span className="min-w-[8rem]">{degreeLabel(r, region)}</span>
          <span className="flex flex-wrap gap-3">
            {(['right', 'left'] as const).map((side) => (
              <label key={side} className="flex items-center gap-1.5">
                <span className="w-3 text-[12px] font-semibold text-muted">{side === 'right' ? 'R' : 'L'}</span>
                <input type="number" inputMode="numeric" min={0} max={max} aria-label={`${degreeLabel(r, region)} ${side} degrees`}
                  value={value[r.value]?.[side] ?? ''} onChange={(e) => setDeg(r.value, side, e.target.value)}
                  className="h-8 w-16 rounded-md border border-line-strong bg-surface px-2 text-[13px] tabular-nums" />
                <span className="text-[12px] text-muted">°</span>
              </label>
            ))}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Pick the tests performed for this region; each picked test then asks for its result. */
function SpecialTests({ region, value, onChange }: { region?: string; value: Record<string, string>; onChange: (v: unknown) => void }) {
  const tests = SPECIAL_TESTS[region ?? '']
  if (!tests) return <p className="text-[14px] text-muted">{region ? 'No special-test list for this region yet.' : 'Choose a body region in Patient & visit to see its special tests.'}</p>
  const toggle = (t: string) => {
    const rest = { ...value }
    if (t in rest) delete rest[t]
    else rest[t] = ''
    onChange(rest)
  }
  return (
    <div className="space-y-4">
      <Field label="Tests performed">
        <Chips label="Tests performed" options={tests} isOn={(v) => v in value} onToggle={toggle} />
      </Field>
      {tests.some((t) => t.value in value) && (
        <ul className="divide-y divide-line border-y border-line">
          {tests.filter((t) => t.value in value).map((t) => (
            <li key={t.value} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[14px]">
              <span>{t.label}</span>
              <Chips label={`${t.label} result`} options={TEST_RESULTS} isOn={(v) => value[t.value] === v} onToggle={(v) => onChange({ ...value, [t.value]: v })} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
