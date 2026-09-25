import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export function Logo({ className = 'h-9', dark = false }: { className?: string; dark?: boolean }) {
  return (
    <img
      src={dark ? '/brand/physionexs-logo-dark.svg' : '/brand/physionexs-logo.svg'}
      alt="Physionexs"
      className={cx(className, 'w-auto')}
    />
  )
}

type ButtonVariant = 'primary' | 'leaf' | 'secondary' | 'ghost'

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-2',
  leaf: 'bg-leaf text-white hover:bg-leaf-dark',
  secondary: 'bg-surface text-ink border border-ink hover:bg-surface-2',
  ghost: 'text-brand hover:bg-brand-tint',
}

export function Button({
  variant = 'primary',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        'inline-flex h-11 items-center justify-center gap-2 rounded-md px-5 text-[12.5px] font-semibold uppercase tracking-[0.09em] transition',
        'disabled:cursor-not-allowed disabled:opacity-60',
        buttonStyles[variant],
        className,
      )}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="eyebrow mb-1.5 block">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[12px] text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[12px] text-muted">{hint}</span>
      ) : null}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'h-11 w-full rounded-md border border-line-strong bg-surface px-3.5 text-[14px] text-ink',
        'placeholder:text-subtle focus:border-ink focus:outline-none',
        props.className,
      )}
    />
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl border border-line bg-surface', className)}>{children}</div>
}

export function Alert({ tone = 'danger', children }: { tone?: 'danger' | 'info' | 'warning'; children: ReactNode }) {
  const tones = {
    danger: 'bg-danger-tint text-danger',
    info: 'bg-brand-tint text-brand',
    warning: 'bg-amber-tint text-amber',
  }
  return <div className={cx('rounded-md px-3.5 py-2.5 text-[13px] font-medium', tones[tone])}>{children}</div>
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="grid auto-cols-fr grid-flow-col border-b border-line" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            '-mb-px h-10 border-b-2 text-[12px] font-semibold uppercase tracking-[0.09em] transition',
            value === o.value ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Spinner({ className = 'size-6' }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center text-brand">
      <Spinner className="size-8" />
    </div>
  )
}

export function initials(name: string) {
  return name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cx(
        'inline-grid size-9 shrink-0 place-items-center rounded-full border border-line-strong bg-surface text-[12px] font-semibold text-ink',
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
