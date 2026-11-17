// iptv-org uses "uk" in its IDs, but the ISO code for the United Kingdom is "gb".
const ALIASES: Record<string, string> = { uk: 'GB' }

let names: Intl.DisplayNames | undefined
try {
  names = new Intl.DisplayNames(['en'], { type: 'region' })
} catch {
  names = undefined
}

export function isoCode(code: string): string {
  return ALIASES[code.toLowerCase()] ?? code.toUpperCase()
}

export function countryName(code: string): string {
  try {
    return names?.of(isoCode(code)) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

export function countryFlag(code: string): string {
  const iso = isoCode(code)
  if (!/^[A-Z]{2}$/.test(iso)) return '🏳️'
  return String.fromCodePoint(...[...iso].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
}
