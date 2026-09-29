import { Image } from 'expo-image'
import { Link, router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, View } from 'react-native'

import { useSession } from '@/auth/session'
import { Approach } from '@/components/Approach'
import { Button, Card, ErrorText, Field, Screen, Text } from '@/components/ui'
import { colors, font } from '@shared/tokens'

/** Patients sign in with email + password. Clinic accounts are refused here and sent to the practice console. */
export default function SignIn() {
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 8 }}>
          <Image source={require('@/assets/images/splash-icon.png')} style={{ width: 72, height: 72 }} contentFit="contain" />
          <Text style={{ fontFamily: font.extrabold, fontSize: 30, letterSpacing: -1, marginTop: 8 }}>
            <Text style={{ fontFamily: font.extrabold, fontSize: 30, color: colors.brand }}>Physio</Text>
            <Text style={{ fontFamily: font.extrabold, fontSize: 30, color: colors.leaf }}>nexs</Text>
          </Text>
          <Text style={{ marginTop: 6, textAlign: 'center', fontFamily: font.bold, fontSize: 15, color: '#0F2A33' }}>
            Recover with a plan.{' '}
            <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.brand }}>Track.</Text>{' '}
            <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.leaf }}>Heal.</Text>{' '}
            <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.sun }}>Thrive.</Text>
          </Text>
        </View>

        <EmailForm />

        <Link href="/physio-sign-in" style={{ alignSelf: 'center', padding: 8 }}>
          <Text variant="eyebrow" style={{ color: colors.ink }}>I’m a physiotherapist →</Text>
        </Link>

        <Approach />
      </Screen>
    </KeyboardAvoidingView>
  )
}

function EmailForm() {
  const { login, registerPatient } = useSession()
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [f, setF] = useState({ full_name: '', email: '', phone: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v })

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'register') await registerPatient({ full_name: f.full_name, email: f.email, phone: f.phone || null, password: f.password })
      else await login(f.email, f.password, 'patient')
      router.replace('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ gap: 16 }}>
      <Text variant="title">{mode === 'register' ? 'Create your account' : 'Welcome'}</Text>
      {error && <ErrorText>{error}</ErrorText>}
      {mode === 'register' && <Field label="Full name" value={f.full_name} onChangeText={set('full_name')} autoComplete="name" />}
      <Field label="Email" value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
      {mode === 'register' && <Field label="Mobile number (optional)" hint="For appointment reminders. You sign in with your email." value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" />}
      <Field label="Password" hint={mode === 'register' ? 'At least 8 characters.' : undefined} value={f.password} onChangeText={set('password')} secureTextEntry
        textContentType={mode === 'register' ? 'newPassword' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
      <Button title={mode === 'register' ? 'Create account' : 'Sign in'} onPress={submit} loading={busy} />
      {mode === 'signin' && <Button variant="ghost" title="Forgot password?" onPress={() => router.push('/forgot-password')} />}
      <Button variant="ghost" title={mode === 'register' ? 'I already have an account' : 'Create an account'} onPress={() => setMode(mode === 'register' ? 'signin' : 'register')} />
    </Card>
  )
}
