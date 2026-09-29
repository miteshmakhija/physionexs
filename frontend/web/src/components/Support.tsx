import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { Card } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'

function useSupport() {
  return useQuery({ queryKey: ['support'], queryFn: () => api<Schemas['SupportOut']>('/platform/support'), staleTime: 60 * 60_000 })
}

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

/** "Need help?" card for signed-in patients. */
export function SupportCard() {
  const s = useSupport().data
  if (!s) return null
  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-semibold">Need help?</h2>
      <p className="mt-1 text-[13.5px] text-muted">Our care team is here for any query · {s.hours}</p>
      <div className="mt-4 grid gap-3 text-[14px] sm:grid-cols-2">
        <a href={telHref(s.phone)} className="border border-line p-3 hover:border-ink">
          <span className="eyebrow block">Helpline</span>
          <span className="mt-1 block font-semibold">{s.phone}</span>
        </a>
        <a href={`mailto:${s.email}`} className="border border-line p-3 hover:border-ink">
          <span className="eyebrow block">Email</span>
          <span className="mt-1 block font-semibold">{s.email}</span>
        </a>
      </div>
    </Card>
  )
}

/** Site footer with contact details. */
export function SupportFooter() {
  const s = useSupport().data
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-[13.5px] sm:grid-cols-3 sm:px-6">
        <div>
          <p className="eyebrow mb-2">Contact</p>
          {s && (
            <>
              <a href={`mailto:${s.email}`} className="block hover:underline">{s.email}</a>
              <a href={telHref(s.phone)} className="block hover:underline">{s.phone}</a>
            </>
          )}
        </div>
        <div>
          <p className="eyebrow mb-2">Office</p>
          {s && <p className="max-w-xs text-ink-2">{s.address}</p>}
        </div>
        <div>
          <p className="eyebrow mb-2">Support hours</p>
          {s && <p className="text-ink-2">{s.hours}</p>}
          <p className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
            <span>© {new Date().getFullYear()} Physionexs</span>
            <Link to="/terms" className="hover:text-ink hover:underline">Terms &amp; Conditions</Link>
            <Link to="/privacy" className="hover:text-ink hover:underline">Privacy Policy</Link>
          </p>
        </div>
      </div>
    </footer>
  )
}
