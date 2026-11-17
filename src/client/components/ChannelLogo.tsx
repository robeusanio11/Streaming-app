import { useState } from 'react'

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase()
}

/** Shows the channel logo, or the channel's initials if there is no logo or it fails to load. */
export function ChannelLogo({ src, name }: { src?: string; name: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) {
    return (
      <div className="logo fallback" aria-hidden>
        {initials(name)}
      </div>
    )
  }
  return (
    <div className="logo">
      <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    </div>
  )
}
