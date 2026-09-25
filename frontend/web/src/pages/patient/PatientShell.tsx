import { NavLink, Outlet } from 'react-router'

import { useAuth } from '@/auth/AuthProvider'
import { Avatar, cx, Logo } from '@/components/ui'

const TABS = [
  { to: '/app', label: 'Home', end: true },
  { to: '/app/find', label: 'Find a physio' },
  { to: '/app/plan', label: 'Care plan' },
  { to: '/app/exercises', label: 'Exercises' },
  { to: '/app/progress', label: 'Progress' },
]

export default function PatientShell() {
  const { me, logout } = useAuth()
  return (
    <div className="min-h-dvh pb-20 sm:pb-0">
      <header className="sticky top-0 z-20 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3 sm:px-6">
          <Logo className="h-8" />
          <nav className="hidden flex-1 gap-1 sm:flex">
            {TABS.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cx(
                    'px-3 py-1.5 text-[13.5px]',
                    isActive ? 'font-semibold text-ink underline underline-offset-8' : 'text-muted hover:text-ink',
                  )
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Avatar name={me?.full_name ?? '?'} />
            <button onClick={() => void logout()} className="text-[12.5px] font-semibold text-muted hover:text-danger">
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>

      {/* Bottom tab bar on phones, like the app */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-surface sm:hidden">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cx('py-3 text-center text-[11px] font-semibold', isActive ? 'text-ink' : 'text-subtle')
            }
          >
            {t.label.replace('Find a physio', 'Find')}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
