// Physionexs design tokens, shared by web and mobile.
// Web mirrors these in frontend/web/src/index.css (@theme) — keep both in sync.

export const colors = {
  brand: '#1170C2',
  brandTint: '#E7F1FB',
  leaf: '#33A532',
  leafDark: '#2C8E26',
  leafTint: '#EAF6E6',
  sun: '#F47C1B',
  amber: '#C9821E',
  amberTint: '#FDEEDD',
  danger: '#DD5A4E',
  dangerTint: '#FBE9E7',
  violet: '#7C6CE0',

  // Minimal monochrome base (white canvas, near-black text, hairlines).
  // Brand blue/green are accents only: logo, links, active states.
  ink: '#141414',
  ink2: '#2E2E2E',
  muted: '#646867',
  subtle: '#A7A7A9',
  line: '#ECECED',
  lineStrong: '#D4D4D6',
  surface: '#FFFFFF',
  surface2: '#F7F7F7',
  canvas: '#FFFFFF',
} as const

export const radius = { sm: 2, md: 4, lg: 6, xl: 8 } as const

/** Uppercase micro-label style (11px, +0.09em tracking). */
export const eyebrow = { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' } as const

export const font = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const
