import { Image } from 'expo-image'
import { Link, router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, View } from 'react-native'

import { useSession } from '@/auth/session'
import { Button, Card, ErrorText, Field, Screen, Text } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { colors, font } from '@shared/tokens'

/** Patients (and clinic staff) sign in with a phone OTP. New numbers are asked for a name. */
export default function SignIn() {
  const { requestOtp, verifyOtp } = useSession()
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [fullName, setFullName] = useState('')
  const [needsName, setNeedsName] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (step === 'phone') {
        await requestOtp(phone)
        setStep('code')
      } else {
        await verifyOtp(phone, code, needsName ? fullName : undefined)
        router.replace('/')
      }
    } catch (e) {
      if (e instanceof ApiError && e.detail === 'full_name_required') setNeedsName(true)
      else setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 8 }}>
          <Image source={require('@/assets/images/splash-icon.png')} style={{ width: 72, height: 72 }} contentFit="contain" />
          <Text style={{ fontFamily: font.extrabold, fontSize: 30, letterSpacing: -1, marginTop: 8 }}>
            <Text style={{ fontFamily: font.extrabold, fontSize: 30, color: colors.brand }}>Physio</Text>
            <Text style={{ fontFamily: font.extrabold, fontSize: 30, color: colors.leaf }}>nexs</Text>
          </Text>
          <Text style={{ marginTop: 6, textAlign: 'center' }}>Recover with a plan. Track. Heal. Thrive.</Text>
        </View>

        <Card style={{ gap: 16 }}>
          <View>
            <Text variant="title">{needsName ? 'Create your account' : 'Welcome'}</Text>
            <Text style={{ marginTop: 4 }}>
              {step === 'phone' ? 'We’ll text you a one-time code.' : `Enter the code sent to ${phone}.`}
            </Text>
          </View>
          {error && <ErrorText>{error}</ErrorText>}
          {step === 'phone' ? (
            <Field
              label="Mobile number"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              placeholder="98123 45678"
              autoFocus
            />
          ) : (
            <>
              <Field
                label="6-digit code"
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={8}
                autoFocus
                style={{ letterSpacing: 8 }}
              />
              {needsName && (
                <Field
                  label="Full name"
                  hint="New to Physionexs — tell us what to call you."
                  value={fullName}
                  onChangeText={setFullName}
                  autoComplete="name"
                  autoFocus
                />
              )}
            </>
          )}
          <Button
            title={step === 'phone' ? 'Send code' : needsName ? 'Create account' : 'Verify & continue'}
            onPress={submit}
            loading={busy}
          />
          {step === 'code' && (
            <Button
              variant="ghost"
              title="Use a different number"
              onPress={() => {
                setStep('phone')
                setCode('')
                setNeedsName(false)
              }}
            />
          )}
        </Card>

        <Link href="/physio-sign-in" style={{ alignSelf: 'center', padding: 8 }}>
          <Text variant="eyebrow" style={{ color: colors.ink }}>I’m a physiotherapist →</Text>
        </Link>
      </Screen>
    </KeyboardAvoidingView>
  )
}
