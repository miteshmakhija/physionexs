import { router } from 'expo-router'
import { Alert } from 'react-native'

import type { Schemas } from '@/lib/api'

export interface PaymentResult {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

type Pending = {
  checkout: Schemas['RazorpayCheckout']
  resolve: (r: PaymentResult | null) => void
  reject: (e: Error) => void
}

let pending: Pending | null = null

/** Opens Razorpay Checkout (in the /patient/pay WebView). Resolves null if the patient closes it. */
export function payWithRazorpay(checkout: Schemas['RazorpayCheckout']): Promise<PaymentResult | null> {
  // Local dev without Razorpay keys: the API issues simulated orders.
  if (checkout.order_id.startsWith('order_dev_')) {
    return new Promise((resolve) =>
      Alert.alert('Development mode', `Simulate a successful payment of ₹${checkout.amount / 100}?`, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
        {
          text: 'Pay',
          onPress: () =>
            resolve({ razorpay_order_id: checkout.order_id, razorpay_payment_id: `pay_dev_${Date.now()}`, razorpay_signature: 'dev' }),
        },
      ]),
    )
  }
  return new Promise((resolve, reject) => {
    pending = { checkout, resolve, reject }
    router.push('/patient/pay')
  })
}

export function currentCheckout() {
  return pending?.checkout ?? null
}

export function settlePayment(outcome: { result?: PaymentResult | null; error?: string }) {
  const p = pending
  pending = null
  if (!p) return
  if (outcome.error) p.reject(new Error(outcome.error))
  else p.resolve(outcome.result ?? null)
}
