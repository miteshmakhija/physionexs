import { router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native'

import { useSession } from '@/auth/session'
import { Button, Card, ErrorText, Field, Screen, Text } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { colors, font, radius } from '@shared/tokens'

type Role = 'doctor' | 'staff'

/** Practice console sign-in by email + password for the Doctor-Admin and Staff. Staff are added by the clinic. */
export default function PhysioSignIn() {
  const [role, setRole] = useState<Role>('doctor')

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <Button variant="ghost" title="← Back" onPress={() => router.back()} />
        <Card style={{ gap: 16 }}>
          <Text variant="title">Practice console</Text>
          <Text variant="label">Sign in as</Text>
          <View style={{ flexDirection: 'row', gap: 4, backgroundColor: colors.canvas, borderRadius: radius.lg, padding: 4, borderWidth: 1, borderColor: colors.line }}>
            {([
              ['doctor', 'Doctor-Admin', 'Owner · full access'],
              ['staff', 'Staff', 'No billing / analytics'],
            ] as const).map(([value, title, sub]) => (
              <Pressable
                key={value}
                onPress={() => setRole(value)}
                accessibilityRole="tab"
                accessibilityState={{ selected: role === value }}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: role === value ? '#fff' : 'transparent' }}
              >
                <Text style={{ fontFamily: font.semibold, fontSize: 15, color: role === value ? colors.brand : colors.ink2 }}>{title}</Text>
                <Text variant="caption">{sub}</Text>
              </Pressable>
            ))}
          </View>
          <PasswordForm key={role} />
          <Button variant="ghost" title="Forgot password?" onPress={() => router.push('/forgot-password')} />
          <Text variant="caption" style={{ textAlign: 'center' }}>
            {role === 'doctor' ? 'New clinic? Register at physionexs.com' : 'Use the email and temporary password your clinic’s Doctor-Admin gave you.'}
          </Text>
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  )
}

function PasswordForm() {
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
      await login(identifier, password, 'clinic', needsTotp ? totp : undefined)
      router.replace('/')
    } catch (e) {
      if (e instanceof ApiError && e.detail === 'totp_required') setNeedsTotp(true)
      else setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ gap: 16 }}>
      {error && <ErrorText>{error}</ErrorText>}
      <Field label="Email" value={identifier} onChangeText={setIdentifier} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" />
      {needsTotp && (
        <Field label="Two-factor authentication code" hint="Enter the 6-digit code from your authenticator app." value={totp}
          onChangeText={(t) => setTotp(t.replace(/\D/g, ''))} keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} autoFocus />
      )}
      <Button title="Sign in" onPress={submit} loading={busy} />
    </View>
  )
}
