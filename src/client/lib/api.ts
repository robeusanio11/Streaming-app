import type { ChannelData } from '../../shared/channels'

export async function fetchPlaylist(url?: string, refresh = false): Promise<ChannelData> {
  const q = new URLSearchParams()
  if (url) q.set('url', url)
  if (refresh) q.set('refresh', '1')
  const res = await fetch(`/api/playlist?${q}`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Could not load playlist (HTTP ${res.status})`)
  return body as ChannelData
}

export async function fetchDefaultPlaylistUrl(): Promise<string> {
  const res = await fetch('/api/config')
  const body = await res.json()
  return body.defaultPlaylistUrl as string
}
