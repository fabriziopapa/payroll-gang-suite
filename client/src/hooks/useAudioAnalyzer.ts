// ============================================================
// PAYROLL GANG SUITE — useAudioAnalyzer
// Web Audio API: FFT analysis per visualizzazione in real-time
// ============================================================

import { useRef, useEffect, useCallback, useState } from 'react'

const FFT_SIZE              = 512   // potenza di 2 — risoluzione freq
const SMOOTHING             = 0.82  // inerzia tra frame (0=scatta, 1=immobile)

// Bins FFT → bande percettive (campionamento 44100 Hz, FFT/2 = 256 bin)
// Ogni bin ≈ 44100/512 ≈ 86 Hz
const BASS_END  = 8   // ~0-688 Hz
const MID_END   = 48  // ~688-4128 Hz
// restante = high

// ── Tipi pubblici ────────────────────────────────────────────

export interface FrequencyBands {
  bass: number      // 0..1 — energia banda basse frequenze
  mid:  number      // 0..1 — energia banda medie
  high: number      // 0..1 — energia banda alte
  raw:  Uint8Array  // FFT completo (FFT_SIZE/2 bin)
}

export interface AudioAnalyzerControls {
  isPlaying: boolean
  bands:     FrequencyBands
  start:     () => Promise<void>
  stop:      () => void
}

// ── Utility ───────────────────────────────────────────────────

function bandAverage(arr: Uint8Array, from: number, to: number): number {
  let sum = 0
  const len = Math.min(to, arr.length)
  for (let i = from; i < len; i++) sum += arr[i]!
  return sum / ((len - from) * 255)
}

// ── Hook ──────────────────────────────────────────────────────

export function useAudioAnalyzer(src: string): AudioAnalyzerControls {
  const ctxRef      = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef   = useRef<AudioBufferSourceNode | null>(null)
  const rafRef      = useRef<number>(0)
  const dataRef     = useRef(new Uint8Array(FFT_SIZE / 2))
  const mountedRef  = useRef(true)

  const [isPlaying, setIsPlaying] = useState(false)
  const [bands, setBands] = useState<FrequencyBands>({
    bass: 0,
    mid:  0,
    high: 0,
    raw:  new Uint8Array(FFT_SIZE / 2),
  })

  // ── Loop analisi in requestAnimationFrame ─────────────────

  const tick = useCallback(() => {
    if (!analyserRef.current || !mountedRef.current) return

    analyserRef.current.getByteFrequencyData(dataRef.current)

    const snapshot = new Uint8Array(dataRef.current) // copia per React state
    setBands({
      bass: bandAverage(snapshot, 0,        BASS_END),
      mid:  bandAverage(snapshot, BASS_END, MID_END),
      high: bandAverage(snapshot, MID_END,  snapshot.length),
      raw:  snapshot,
    })

    rafRef.current = requestAnimationFrame(tick)
  }, [])

  // ── Start: fetch → decode → play ─────────────────────────

  const start = useCallback(async () => {
    if (ctxRef.current) return // già in esecuzione

    try {
      const ctx      = new AudioContext()
      ctxRef.current = ctx

      const analyser               = ctx.createAnalyser()
      analyser.fftSize              = FFT_SIZE
      analyser.smoothingTimeConstant = SMOOTHING
      analyserRef.current          = analyser

      // Gain per fade-in morbido all'avvio
      const gainNode = ctx.createGain()
      gainNode.gain.setValueAtTime(0, ctx.currentTime)
      gainNode.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5)

      const resp        = await fetch(src, { cache: 'force-cache' })
      const arrayBuffer = await resp.arrayBuffer()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

      if (!mountedRef.current) { ctx.close(); return }

      const source   = ctx.createBufferSource()
      source.buffer  = audioBuffer
      source.loop    = true
      source.connect(gainNode)
      gainNode.connect(analyser)
      analyser.connect(ctx.destination)
      source.start(0)
      sourceRef.current = source

      if (mountedRef.current) setIsPlaying(true)
      rafRef.current = requestAnimationFrame(tick)
    } catch (err) {
      console.warn('[useAudioAnalyzer] start error', err)
    }
  }, [src, tick])

  // ── Stop: fade-out → close AudioContext ──────────────────

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)

    if (ctxRef.current && sourceRef.current) {
      const ctx      = ctxRef.current
      const source   = sourceRef.current
      const gainNode = ctx.createGain()
      try {
        source.connect(gainNode)
        gainNode.connect(ctx.destination)
        gainNode.gain.setValueAtTime(1, ctx.currentTime)
        gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8)
        setTimeout(() => {
          try { source.stop() } catch { /* ignore */ }
          ctx.close()
        }, 900)
      } catch {
        try { source.stop() } catch { /* ignore */ }
        ctx.close()
      }
    }

    ctxRef.current    = null
    sourceRef.current = null
    analyserRef.current = null

    if (mountedRef.current) {
      setIsPlaying(false)
      setBands({ bass: 0, mid: 0, high: 0, raw: new Uint8Array(FFT_SIZE / 2) })
    }
  }, [])

  // ── Cleanup al unmount ────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelAnimationFrame(rafRef.current)
      try { sourceRef.current?.stop() } catch { /* ignore */ }
      ctxRef.current?.close()
    }
  }, [])

  return { isPlaying, bands, start, stop }
}
