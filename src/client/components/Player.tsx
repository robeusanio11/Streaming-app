import Hls, { type ErrorData } from 'hls.js'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Channel, StreamSource } from '../../shared/channels'
import { relayUrl } from '../../shared/relay'

export type PlaybackMode = 'auto' | 'relay' | 'direct'

interface Attempt {
  streamIndex: number
  stream: StreamSource
  viaRelay: boolean
}

interface Props {
  channel: Channel | null
  mode: PlaybackMode
  onResult: (url: string, ok: boolean) => void
  onPrev: () => void
  onNext: () => void
  /** Shown under the stream details, e.g. the programme that's on now. */
  children?: ReactNode
}

/** How long a stream gets to start playing before the next one is tried. */
const START_TIMEOUT_MS = 20_000

function streamKind(url: string): 'hls' | 'dash' | 'file' {
  const path = url.split(/[?#]/)[0].toLowerCase()
  if (path.endsWith('.mpd')) return 'dash'
  if (/\.(mp4|webm|ogg|mp3|aac|m4a)$/.test(path)) return 'file'
  // Most iptv-org URLs are HLS, including many without a .m3u8 extension.
  return 'hls'
}

/** A browser can only fetch a stream directly when it needs no special headers and won't be blocked as mixed content. */
function canPlayDirect(s: StreamSource): boolean {
  if (s.referrer || s.userAgent) return false
  return s.url.startsWith('https:') || window.location.protocol === 'http:'
}

function buildAttempts(streams: StreamSource[], mode: PlaybackMode): Attempt[] {
  const out: Attempt[] = []
  streams.forEach((stream, streamIndex) => {
    if (mode === 'direct') out.push({ stream, streamIndex, viaRelay: false })
    else if (mode === 'relay' || !canPlayDirect(stream)) out.push({ stream, streamIndex, viaRelay: true })
    else {
      out.push({ stream, streamIndex, viaRelay: false })
      out.push({ stream, streamIndex, viaRelay: true })
    }
  })
  return out
}

function describeHlsError(data: ErrorData): string {
  const code = (data.response as { code?: number } | undefined)?.code
  if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
    return code ? `Stream server returned HTTP ${code}` : 'Could not reach the stream server'
  }
  if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) return 'Stream server timed out'
  if (data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR) return 'Not a playable HLS stream'
  if (data.type === Hls.ErrorTypes.MEDIA_ERROR) return 'The browser could not decode this stream'
  return `Playback error (${data.details})`
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; message: string }
  | { kind: 'playing' }
  | { kind: 'failed'; message: string }

export function Player({ channel, mode, onResult, onPrev, onNext, children }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [attemptIndex, setAttemptIndex] = useState(0)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [lastError, setLastError] = useState<string>('')

  const attempts = useMemo(() => (channel ? buildAttempts(channel.streams, mode) : []), [channel, mode])

  // The parent sets a React key per channel and mode, so this state starts fresh for each.
  const attempt = attempts[attemptIndex] as Attempt | undefined

  // Keep the latest callback in a ref so the playback effect doesn't restart when it changes.
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!channel) {
      setStatus({ kind: 'idle' })
      return
    }
    if (!attempt) {
      setStatus({
        kind: 'failed',
        message: lastError ? `None of this channel's streams worked. Last error: ${lastError}` : 'No streams available',
      })
      return
    }

    const { stream, viaRelay } = attempt
    const total = channel.streams.length
    setStatus({
      kind: 'loading',
      message: `Connecting to stream ${attempt.streamIndex + 1} of ${total}${viaRelay ? ' via relay' : ''}…`,
    })

    let done = false
    let hls: Hls | null = null
    let mediaRecoveries = 0

    const fail = (reason: string) => {
      if (done) return
      done = true
      // Only record a failure for the stream once its last attempt (usually via the relay) has failed.
      const next = attempts[attemptIndex + 1]
      if (!next || next.streamIndex !== attempt.streamIndex) onResultRef.current(stream.url, false)
      setLastError(reason)
      setAttemptIndex(i => i + 1)
    }

    const startTimer = window.setTimeout(() => fail('Timed out waiting for video'), START_TIMEOUT_MS)

    const onPlaying = () => {
      window.clearTimeout(startTimer)
      if (!done) {
        done = true
        onResultRef.current(stream.url, true)
      }
      setStatus({ kind: 'playing' })
    }
    const onWaiting = () => setStatus(s => (s.kind === 'playing' ? { kind: 'loading', message: 'Buffering…' } : s))
    const onVideoError = () => fail(video.error?.message || 'The browser could not play this stream')

    video.addEventListener('playing', onPlaying)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('error', onVideoError)

    const src = viaRelay ? relayUrl(stream.url, { referrer: stream.referrer, userAgent: stream.userAgent }) : stream.url
    const kind = streamKind(stream.url)

    const play = () => {
      video.play().catch(err => {
        // Autoplay with sound can be blocked. Mute and try again; the user can unmute.
        if ((err as DOMException).name === 'NotAllowedError') {
          video.muted = true
          video.play().catch(() => {})
        }
      })
    }

    if (kind === 'dash') {
      // Defer the failure so it isn't reported while this effect is still running.
      window.setTimeout(() => fail('DASH (.mpd) streams are not supported yet'), 0)
    } else if (kind === 'hls' && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        manifestLoadingMaxRetry: 1,
        manifestLoadingTimeOut: 12_000,
        levelLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 3,
        backBufferLength: 30,
      })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
          mediaRecoveries++
          hls?.recoverMediaError()
          return
        }
        if (done && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // The stream was playing and then dropped. Restart loading once before giving up.
          hls?.startLoad()
          return
        }
        fail(describeHlsError(data))
      })
      hls.on(Hls.Events.MANIFEST_PARSED, play)
      hls.loadSource(src)
      hls.attachMedia(video)
    } else {
      // Safari plays HLS natively. Other formats go straight to the <video> element.
      video.src = src
      play()
    }

    return () => {
      window.clearTimeout(startTimer)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('error', onVideoError)
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
    // attempt and attempts change together. lastError is read only for the final message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, attempt])

  const pickStream = (streamIndex: number) => {
    const idx = attempts.findIndex(a => a.streamIndex === streamIndex)
    if (idx >= 0) setAttemptIndex(idx)
  }

  const current = attempt?.stream

  return (
    <section className="player">
      <div className="video-wrap">
        <video ref={videoRef} controls playsInline className="video" />
        {status.kind !== 'playing' && (
          <div className={`overlay ${status.kind}`}>
            {status.kind === 'idle' && <p>Pick a channel to start watching</p>}
            {status.kind === 'loading' && (
              <>
                <div className="spinner" aria-hidden />
                <p>{status.message}</p>
                {lastError && <p className="muted small">Previous stream: {lastError}</p>}
              </>
            )}
            {status.kind === 'failed' && (
              <>
                <p>{status.message}</p>
                <button className="btn" onClick={() => setAttemptIndex(0)}>
                  Try again
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {channel && (
        <div className="now-playing">
          <div className="np-title">
            <button className="icon-btn" onClick={onPrev} title="Previous channel" aria-label="Previous channel">
              ‹
            </button>
            <h2>{channel.name}</h2>
            <button className="icon-btn" onClick={onNext} title="Next channel" aria-label="Next channel">
              ›
            </button>
          </div>
          <div className="np-meta">
            {channel.streams.length > 1 ? (
              <label className="stream-pick">
                Stream
                <select value={attempt?.streamIndex ?? ''} onChange={e => pickStream(Number(e.target.value))}>
                  {channel.streams.map((s, i) => (
                    <option key={s.url} value={i}>
                      {i + 1}. {s.quality ?? 'Unknown quality'}
                      {s.labels.length ? ` · ${s.labels.join(', ')}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {current?.quality && <span className="tag">{current.quality}</span>}
            {current?.labels.map(l => (
              <span key={l} className="tag warn">
                {l}
              </span>
            ))}
            {attempt && <span className="tag subtle">{attempt.viaRelay ? 'Via relay' : 'Direct'}</span>}
          </div>
          {children}
        </div>
      )}
    </section>
  )
}
