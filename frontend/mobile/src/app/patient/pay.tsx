import { router } from 'expo-router'
import { useEffect, useMemo, useRef } from 'react'
import { Linking, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import { Loading, Text } from '@/components/ui'
import { currentCheckout, settlePayment } from '@/lib/payments'

/** Hosts Razorpay Checkout in a WebView and reports the outcome back to payWithRazorpay(). */
export default function Pay() {
  const checkout = currentCheckout()
  const settled = useRef(false)

  const finish = (outcome: Parameters<typeof settlePayment>[0]) => {
    if (settled.current) return
    settled.current = true
    settlePayment(outcome)
    router.back()
  }

  // Swiping the modal away counts as closing checkout.
  useEffect(() => () => {
    if (!settled.current) settlePayment({ result: null })
  }, [])

  const html = useMemo(() => (checkout ? checkoutHtml(checkout) : ''), [checkout])

  if (!checkout) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text>No payment in progress.</Text>
      </View>
    )
  }

  const onMessage = (e: WebViewMessageEvent) => {
    const msg = JSON.parse(e.nativeEvent.data) as { type: string; error?: string } & Record<string, string>
    if (msg.type === 'success') {
      finish({ result: { razorpay_order_id: msg.razorpay_order_id, razorpay_payment_id: msg.razorpay_payment_id, razorpay_signature: msg.razorpay_signature } })
    } else if (msg.type === 'failed') {
      finish({ error: msg.error ?? 'Payment failed' })
    } else if (msg.type === 'dismiss') {
      finish({ result: null })
    }
  }

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html, baseUrl: 'https://physionexs.com' }}
      onMessage={onMessage}
      startInLoadingState
      renderLoading={() => <Loading />}
      javaScriptEnabled
      // UPI intents (upi://, tez://, phonepe:// …) must open the installed UPI app.
      onShouldStartLoadWithRequest={(req) => {
        if (/^https?:|^about:|^data:/.test(req.url)) return true
        void Linking.openURL(req.url).catch(() => undefined)
        return false
      }}
    />
  )
}

function checkoutHtml(c: NonNullable<ReturnType<typeof currentCheckout>>) {
  const options = JSON.stringify({
    key: c.key_id,
    order_id: c.order_id,
    amount: c.amount,
    currency: c.currency,
    name: c.name,
    description: c.description,
    prefill: c.prefill,
    theme: { color: '#141414' },
  })
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://checkout.razorpay.com/v1/checkout.js"></script></head><body style="margin:0;background:#fff">
<script>
  function post(m){ window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  var o = ${options};
  o.handler = function(r){ post(Object.assign({ type: 'success' }, r)); };
  o.modal = { ondismiss: function(){ post({ type: 'dismiss' }); }, confirm_close: true };
  var rzp = new Razorpay(o);
  rzp.on('payment.failed', function(r){ post({ type: 'failed', error: (r.error && r.error.description) || 'Payment failed' }); });
  rzp.open();
</script></body></html>`
}
