import { useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors, eyebrow, font, radius } from '@shared/tokens'

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'eyebrow'

const textStyles = StyleSheet.create({
  display: { fontFamily: font.bold, fontSize: 30, letterSpacing: -0.6, color: colors.ink },
  title: { fontFamily: font.bold, fontSize: 24, letterSpacing: -0.4, color: colors.ink },
  heading: { fontFamily: font.bold, fontSize: 15, color: colors.ink },
  body: { fontFamily: font.regular, fontSize: 14, lineHeight: 21, color: colors.muted },
  label: { fontFamily: font.semibold, color: colors.muted, ...eyebrow },
  eyebrow: { fontFamily: font.semibold, color: colors.muted, ...eyebrow },
  caption: { fontFamily: font.medium, fontSize: 12, color: colors.muted },
})

export function Text({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  return <RNText {...props} style={[textStyles[variant], style]} />
}

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const content = <View style={styles.screenInner}>{children}</View>
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = 'primary',
}: {
  title: string
  onPress: () => void
  loading?: boolean
  disabled?: boolean
  variant?: 'primary' | 'leaf' | 'ghost'
}) {
  const bg = variant === 'primary' ? colors.ink : variant === 'leaf' ? colors.leaf : 'transparent'
  const fg = variant === 'ghost' ? colors.ink : '#fff'
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.6 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  )
}

export function Field({ label, hint, secureTextEntry, ...props }: TextInputProps & { label: string; hint?: string }) {
  // Password fields get a Show/Hide toggle so people can check what they typed.
  const [shown, setShown] = useState(false)
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      <View style={{ justifyContent: 'center' }}>
        <TextInput
          placeholderTextColor={colors.subtle}
          {...props}
          secureTextEntry={secureTextEntry && !shown}
          style={[styles.input, secureTextEntry ? { paddingRight: 72 } : null, props.style]}
        />
        {secureTextEntry ? (
          <Pressable
            onPress={() => setShown(!shown)}
            accessibilityRole="button"
            accessibilityLabel={shown ? 'Hide password' : 'Show password'}
            hitSlop={8}
            style={{ position: 'absolute', right: 14 }}
          >
            <Text style={{ fontFamily: font.semibold, fontSize: 12, letterSpacing: 1, color: colors.muted }}>{shown ? 'HIDE' : 'SHOW'}</Text>
          </Pressable>
        ) : null}
      </View>
      {hint ? <Text variant="caption">{hint}</Text> : null}
    </View>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <View style={styles.error}>
      <Text style={{ color: colors.danger, fontFamily: font.medium, fontSize: 13 }}>{children}</Text>
    </View>
  )
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: colors.ink, fontFamily: font.semibold, fontSize: size * 0.32 }}>{initials}</Text>
    </View>
  )
}

export function Placeholder({ title, items }: { title: string; items: string[] }) {
  return (
    <Screen>
      <Text variant="title">{title}</Text>
      <Card style={{ gap: 8 }}>
        <Text variant="eyebrow">Being built next</Text>
        {items.map((i) => (
          <Text key={i}>— {i}</Text>
        ))}
      </Card>
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  screenInner: { flex: 1, padding: 20, gap: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
  },
  button: { height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  buttonText: { fontFamily: font.semibold, fontSize: 12.5, letterSpacing: 1.1, textTransform: 'uppercase' },
  input: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    fontFamily: font.medium,
    fontSize: 15,
    color: colors.ink,
  },
  error: { backgroundColor: colors.dangerTint, borderRadius: radius.md, padding: 12 },
  avatar: { borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
})

export function Chip({
  label,
  selected,
  onPress,
  disabled,
  strike,
}: {
  label: string
  selected?: boolean
  onPress?: () => void
  disabled?: boolean
  strike?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={{
        borderWidth: 1,
        borderColor: selected ? colors.ink : colors.lineStrong,
        backgroundColor: selected ? colors.ink : colors.surface,
        borderRadius: radius.sm,
        paddingHorizontal: 12,
        paddingVertical: 8,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text
        style={{
          fontFamily: font.medium,
          fontSize: 13,
          color: selected ? '#fff' : colors.ink,
          textDecorationLine: strike ? 'line-through' : 'none',
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 6 }}>
      <Text>{label}</Text>
      <Text style={{ color: colors.ink, fontFamily: font.medium, flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  )
}

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <ActivityIndicator color={colors.ink} />
    </View>
  )
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.line }} />
}
