import { router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform } from 'react-native'

import { useSession } from '@/auth/session'
import { Button, Card, ErrorText, Field, Screen, Text } from '@/components/ui'
import { ApiError } from '@/lib/api'

/** Physiotherapists sign in with password + authenticator code. Registration happens on physionexs.com. */
export default function PhysioSignIn() {
  const { login } = useSession()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await login(identifier, password, needsTotp ? totp : undefined)
      router.replace('/')
    } catch (e) {
      if (e instanceof ApiError && e.detail === 'totp_required') setNeedsTotp(true)
      else setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <Button variant="ghost" title="← Back" onPress={() => router.back()} />
        <Card style={{ gap: 16 }}>
          <Text variant="title">Practice console</Text>
          <Text>Sign in to run your clinic on the go.</Text>
          {error && <ErrorText>{error}</ErrorText>}
          <Field
            label="Email or phone"
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoComplete="username"
            textContentType="username"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
          />
          {needsTotp && (
            <Field
              label="Two-factor authentication code"
              hint="Enter the 6-digit code from your authenticator app."
              value={totp}
              onChangeText={(t) => setTotp(t.replace(/\D/g, ''))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={6}
              autoFocus
            />
          )}
          <Button title="Sign in" onPress={submit} loading={busy} />
          <Text variant="caption" style={{ textAlign: 'center' }}>
            New clinic? Register at physionexs.com
          </Text>
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  )
}
