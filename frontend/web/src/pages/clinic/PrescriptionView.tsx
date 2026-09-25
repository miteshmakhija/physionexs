import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'

import { useClinic } from '@/auth/useClinic'
import { RxDocument } from '@/components/clinical'
import { Alert, Button, Loader } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'

export default function PrescriptionView() {
  const { id } = useParams()
  const { clinicId } = useClinic()
  const navigate = useNavigate()
  const rx = useQuery({ queryKey: ['rx', id], queryFn: () => api<Schemas['PrescriptionOut']>(`/clinic/prescriptions/${id}`, { clinicId }) })
  if (rx.isLoading) return <Loader />
  if (!rx.data) return <Alert>Prescription not found.</Alert>
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button onClick={() => navigate(-1)} className="eyebrow hover:underline">← Back</button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.print()}>Print</Button>
          <Button onClick={() => window.print()}>Download PDF</Button>
        </div>
      </div>
      <RxDocument rx={rx.data} />
      <p className="mt-3 text-center text-[12px] text-muted print:hidden">“Download PDF” opens the print dialog — choose “Save as PDF”.</p>
    </div>
  )
}
