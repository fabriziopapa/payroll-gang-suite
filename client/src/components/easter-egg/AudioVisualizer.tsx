// ============================================================
// PAYROLL GANG SUITE — AudioVisualizer
// Equalizzatore canvas sincronizzato alle frequenze FFT
// Stile: minimal cinematografico, barre arrotondate, gradiente viola
// ============================================================

import { useEffect, useRef } from 'react'
import type { FrequencyBands } from '../../hooks/useAudioAnalyzer'

interface Props {
  bands:     FrequencyBands
  isPlaying: boolean
}

const BAR_COUNT   = 52     // numero barre equalizzatore
const BAR_GAP     = 0.18   // percentuale gap tra barre (0..1)
const LERP_FACTOR = 0.18   // velocità smorzamento per bar (0=fermo, 1=immediato)
const MAX_HEIGHT  = 0.88   // altezza massima rispetto al canvas

// ── Gradienti ─────────────────────────────────────────────────
// Variano per position: basse freq = più calde, alte = più fredde
function makeGradient(
  ctx:     CanvasRenderingContext2D,
  x:       number,
  height:  number,
  barH:    number,
  normPos: number,  // 0..1 posizione della barra sul totale
): CanvasGradient {
  const grad = ctx.createLinearGradient(x, height, x, height - barH)

  // Colore base cambia leggermente per posizione (sinistra = bass = più saturo)
  const r1 = Math.round(79  + normPos * 40)   // indigo→violet bottom
  const g1 = Math.round(70  + normPos * 10)
  const b1 = Math.round(229 + normPos * 20)

  grad.addColorStop(0,   `rgba(${r1}, ${g1}, ${b1}, 0.95)`)
  grad.addColorStop(0.6, `rgba(139, 92, 246, 0.65)`)   // violet-500
  grad.addColorStop(1,   `rgba(196, 181, 253, 0.25)`)  // violet-300 — cima sfumata
  return grad
}

// ── Componente ────────────────────────────────────────────────

export default function AudioVisualizer({ bands, isPlaying }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const smoothRef  = useRef<Float32Array>(new Float32Array(BAR_COUNT))
  const rafRef     = useRef<number>(0)
  const bandsRef   = useRef(bands)

  // Mantiene riferimento aggiornato senza re-registrare il loop RAF
  bandsRef.current = bands

  // ── Loop di rendering canvas ───────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    function draw() {
      if (!canvas || !ctx) return
      const W = canvas.width
      const H = canvas.height
      ctx.clearRect(0, 0, W, H)

      const raw  = bandsRef.current.raw
      const step = Math.max(1, Math.floor(raw.length / BAR_COUNT))
      const barW = W / BAR_COUNT

      for (let i = 0; i < BAR_COUNT; i++) {
        // Media FFT per questa barra
        let sum = 0, cnt = 0
        const from = i * step
        const to   = Math.min(from + step, raw.length)
        for (let j = from; j < to; j++) { sum += raw[j]!; cnt++ }
        const target = cnt > 0 ? (sum / cnt) / 255 : 0

        // Lerp smorzato — movimento fluido e naturale
        const prev = smoothRef.current[i] ?? 0
        smoothRef.current[i] = prev + (target - prev) * LERP_FACTOR

        const barH   = smoothRef.current[i]! * H * MAX_HEIGHT
        const normPos = i / BAR_COUNT
        const x      = i * barW + barW * BAR_GAP
        const w      = barW * (1 - BAR_GAP * 2)
        const y      = H - barH
        const r      = Math.min(4, w / 2)  // raggio arrotondamento cima

        if (barH < 1) continue

        ctx.fillStyle = makeGradient(ctx, x, H, barH, normPos)
        ctx.beginPath()

        if (barH > r * 2) {
          // Barra con cima arrotondata
          ctx.moveTo(x + r, y)
          ctx.lineTo(x + w - r, y)
          ctx.arcTo(x + w, y, x + w, y + r, r)
          ctx.lineTo(x + w, H)
          ctx.lineTo(x, H)
          ctx.lineTo(x, y + r)
          ctx.arcTo(x, y, x + r, y, r)
        } else {
          ctx.rect(x, y, w, barH)
        }
        ctx.closePath()
        ctx.fill()
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, []) // [] — il loop legge bandsRef.current (mutable ref), nessuna dep

  // ── Resize observer (HiDPI) ───────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function resize() {
      if (!canvas) return
      const dpr     = Math.min(window.devicePixelRatio || 1, 2)
      const rect    = canvas.getBoundingClientRect()
      canvas.width  = rect.width  * dpr
      canvas.height = rect.height * dpr
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.scale(dpr, dpr)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    return () => ro.disconnect()
  }, [])

  // Decay immediato quando si ferma
  useEffect(() => {
    if (!isPlaying) {
      smoothRef.current.fill(0)
    }
  }, [isPlaying])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      aria-hidden="true"
    />
  )
}
