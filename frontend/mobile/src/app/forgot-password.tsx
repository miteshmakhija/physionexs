import { router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform } from 'react-native'

import { Button, Card, ErrorText, Field, Screen, Text } from '@/components/ui'
import { api, type Schemas } from '@/lib/api'
import { colors } from '@shared/tokens'

/** Reset a password with a 6-digit code sent by email or SMS. */
export default function ForgotPassword() {
  const [step, setStep] = useState<'ask' | 'reset' | 'done'>('ask')
  const [identifier, setIdentifier] = useState('')
  const [channel, setChannel] = useState('email')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <Button variant="ghost" title="← Back" onPress={() => router.back()} />
        <Card style={{ gap: 16 }}>
          <Text variant="title">Reset your password</Text>
          {error && <ErrorText>{error}</ErrorText>}
          {step === 'ask' && (
            <>
              <Text>We’ll send a 6-digit code to your email.</Text>
              <Field label="Email" value={identifier} onChangeText={setIdentifier} keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoFocus />
              <Button
                title="Send code"
                loading={busy}
                disabled={identifier.trim().length < 3}
                onPress={() =>
                  run(async () => {
                    const r = await api<Schemas['ForgotPasswordOut']>('/auth/password/forgot', { method: 'POST', json: { identifier } })
                    setChannel(r.channel)
                    setStep('reset')
                  })
                }
              />
            </>
          )}
          {step === 'reset' && (
            <>
              <Text>If an account exists for {identifier}, we’ve sent a code by {channel === 'sms' ? 'SMS' : 'email'}. It expires in 15 minutes.</Text>
              <Field label="6-digit code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ''))} keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} autoFocus />
              <Field label="New password" hint="At least 8 characters." value={password} onChangeText={setPassword} secureTextEntry textContentType="newPassword" />
              <Button
                title="Set new password"
                loading={busy}
                disabled={code.length !== 6 || password.length < 8}
                onPress={() => run(async () => {
                  await api('/auth/password/reset', { method: 'POST', json: { identifier, code, new_password: password } })
                  setStep('done')
                })}
              />
            </>
          )}
          {step === 'done' && (
            <>
              <Text style={{ color: colors.ink }}>Password updated. Sign in with your new password.</Text>
              <Button title="Back to sign in" onPress={() => router.back()} />
            </>
          )}
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  )
}
