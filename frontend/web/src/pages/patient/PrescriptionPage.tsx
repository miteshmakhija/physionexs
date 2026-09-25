import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import { RxDocument } from '@/components/clinical'
import { Alert, Button, Loader } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'

export default function PrescriptionPage() {
  const { id } = useParams()
  const list = useQuery({ queryKey: ['my-rx'], queryFn: () => api<Schemas['PrescriptionOut'][]>('/me/prescriptions') })
  if (list.isLoading) return <Loader />
  const rx = list.data?.find((r) => r.id === id)
  if (!rx) return <Alert>Prescription not found.</Alert>
  return (
    <div>
      <div className="mb-5 flex items-center justify-between print:hidden">
        <Link to="/app/plan" className="eyebrow hover:underline">← Care plan</Link>
        <Button variant="secondary" onClick={() => window.print()}>Print / Save PDF</Button>
      </div>
      <RxDocument rx={rx} />
    </div>
  )
}
