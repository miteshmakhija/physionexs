import type { Schemas } from '@/lib/api'

/** Subscription "Pay" buttons stay disabled until the Razorpay account is activated. Flip to true to turn them on. */
export const SUBSCRIPTION_PAYMENTS_LIVE = false
export const PAYMENTS_SOON = 'Online payment opens in a day or two.'

export interface PaymentResult {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, cb: (r: unknown) => void) => void }
  }
}

let loading: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve()
    s.onerror = () => {
      loading = null
      reject(new Error('Could not load the payment window. Check your connection.'))
    }
    document.body.appendChild(s)
  })
  return loading
}

/** Opens Razorpay Checkout. Resolves with the signed result, or null if the patient closes it. */
export async function payWithRazorpay(checkout: Schemas['RazorpayCheckout']): Promise<PaymentResult | null> {
  // Local dev without Razorpay keys: the API issues simulated orders.
  if (checkout.order_id.startsWith('order_dev_')) {
    if (!window.confirm(`Development mode — simulate a successful payment of ₹${checkout.amount / 100}?`)) return null
    return { razorpay_order_id: checkout.order_id, razorpay_payment_id: `pay_dev_${Date.now()}`, razorpay_signature: 'dev' }
  }

  await loadScript()
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: checkout.key_id,
      order_id: checkout.order_id,
      amount: checkout.amount,
      currency: checkout.currency,
      name: checkout.name,
      description: checkout.description,
      image: `${window.location.origin}/brand/physionexs-mark.png`,
      prefill: checkout.prefill,
      theme: { color: '#141414' },
      handler: (r: PaymentResult) => resolve(r),
      modal: { ondismiss: () => resolve(null), confirm_close: true },
    })
    rzp.on('payment.failed', (r) => {
      const err = (r as { error?: { description?: string } }).error
      reject(new Error(err?.description ?? 'Payment failed'))
    })
    rzp.open()
  })
}
