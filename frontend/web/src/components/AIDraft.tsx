import { cx } from '@/components/ui'

/** Every AI output is shown as a draft the physio checks. */
export function AIDraft({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cx('rounded-md border border-violet/30 bg-violet/5 p-3 text-[13.5px]', className)}>
      <p className="eyebrow !text-violet">AI draft · check before relying on it</p>
      <p className="mt-1 whitespace-pre-line text-ink-2">{text}</p>
    </div>
  )
}
