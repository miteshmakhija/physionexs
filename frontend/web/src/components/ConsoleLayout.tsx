import { useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router'

import { useAuth } from '@/auth/AuthProvider'
import { Avatar, cx, Logo } from '@/components/ui'

export interface NavItem {
  to: string
  label: string
  end?: boolean
}

export interface NavSection {
  title?: string
  items: NavItem[]
}

/** Sidebar layout shared by the practice console and the Super Admin console. */
export function ConsoleLayout({
  badge,
  sections,
  subtitle,
  banner,
}: {
  badge: string
  sections: NavSection[]
  subtitle?: string
  banner?: ReactNode
}) {
  const { me, logout } = useAuth()
  const [open, setOpen] = useState(false)

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <div className="px-2 pt-1">
        <Link to="/" aria-label="Physionexs home" className="inline-block"><Logo className="h-8" /></Link>
        <p className="eyebrow mt-3">{badge}</p>
      </div>
      {sections.map((s, i) => (
        <div key={s.title ?? i}>
          {s.title && <p className="eyebrow mb-1.5 px-3 !text-subtle">{s.title}</p>}
          <ul className="space-y-0.5">
            {s.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cx(
                      'block border-l-2 px-3 py-2 text-[13.5px] transition',
                      isActive ? 'border-ink font-semibold text-ink' : 'border-transparent text-muted hover:text-ink',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="mt-auto flex items-center gap-3 rounded-md border border-line p-3">
        <Avatar name={me?.full_name ?? '?'} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold">{me?.full_name}</p>
          {subtitle && <p className="truncate text-[11.5px] text-muted">{subtitle}</p>}
        </div>
        <button onClick={() => void logout()} className="text-[12px] font-semibold text-muted hover:text-danger">
          Log out
        </button>
      </div>
    </nav>
  )

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface lg:block">{sidebar}</aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        <Link to="/" aria-label="Physionexs home"><Logo className="h-7" /></Link>
        <button
          onClick={() => setOpen(true)}
          className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-semibold"
          aria-label="Open menu"
        >
          Menu
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-modal>
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[272px] max-w-[85vw] border-r border-line bg-surface">{sidebar}</aside>
        </div>
      )}

      <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">
        {banner}
        <Outlet />
      </main>
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-bold tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

export function ComingSoon({ title, subtitle, items }: { title: string; subtitle?: string; items: string[] }) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      <div className="border-t border-line pt-6">
        <p className="eyebrow">Being built next</p>
        <ul className="mt-3 grid gap-2 text-[13.5px] text-muted sm:grid-cols-2">
          {items.map((i) => (
            <li key={i} className="flex gap-2">
              <span className="text-subtle">—</span>
              {i}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
