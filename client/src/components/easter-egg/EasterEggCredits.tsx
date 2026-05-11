// ============================================================
// PAYROLL GANG SUITE — EasterEggCredits
// Overlay cinematografico con audio analizzato, testo animato,
// grain film e micro-particelle flottanti.
//
// TRIGGER: tieni premuto il badge versione (v26.x.x) per 3 secondi
//          oppure digita la sequenza "ALESSIO" da tastiera.
//
// AUDIO: inserisci il file MP3 in:
//   client/public/assets/alessio-song.mp3
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAudioAnalyzer } from '../../hooks/useAudioAnalyzer'
import AudioVisualizer from './AudioVisualizer'

// ── Configurazione ────────────────────────────────────────────

const AUDIO_SRC = '/assets/alessio-song.mp3'

// ── Testo dedicato ────────────────────────────────────────────
// Modifica SOLO il contenuto testuale, non la struttura dell'array.
// Ogni stringa è un paragrafo con timing indipendente.

const PARAGRAPHS: string[] = [
  'Ad Alessio.',
  '',
  'Ci sono legami che non hanno bisogno di essere spiegati.\nEsistono e basta.\nSilenziosi, profondi, assoluti.',
  '',
  'Questo lavoro porta dentro molte cose di me:\nla ricerca continua, le domande, la voglia di capire ciò che spesso resta invisibile.\nMa dentro ogni riga, in ogni idea, in ogni notte passata a costruire qualcosa, ci sei anche tu.',
  '',
  'La tua curiosità.\nIl tuo modo autentico di guardare il mondo.\nLa luce che riesci ad accendere nelle cose semplici.',
  '',
  'Forse un giorno leggerai queste parole.\nE forse capirai che niente di ciò che nasce davvero dal cuore è mai soltanto "un progetto".',
  '',
  'Perché alcune opere non vengono create solo con la mente.\nVengono costruite con l\'amore.',
  '',
  'E tu, Alessio,\nsei una delle parti più vere della mia esistenza.',
  '',
  '— F.',
]

// ── Particelle sfondo ─────────────────────────────────────────

interface Particle {
  id:     number
  x:      number   // % left
  y:      number   // % top iniziale
  size:   number   // px
  dur:    number   // secondi animazione
  delay:  number   // secondi delay
  drift:  number   // px orizzontale
  opacity: number
}

function generateParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id:      i,
    x:       Math.random() * 100,
    y:       Math.random() * 100,
    size:    Math.random() * 1.8 + 0.6,
    dur:     Math.random() * 20 + 15,
    delay:   Math.random() * 10,
    drift:   (Math.random() - 0.5) * 40,
    opacity: Math.random() * 0.35 + 0.08,
  }))
}

const PARTICLES = generateParticles(28)

// ── Componente principale ─────────────────────────────────────

interface Props {
  onClose: () => void
}

export default function EasterEggCredits({ onClose }: Props) {
  const { isPlaying, bands, start, stop } = useAudioAnalyzer(AUDIO_SRC)
  const [visible, setVisible]             = useState(false)   // fade-in overlay
  const [closing, setClosing]             = useState(false)   // fade-out overlay
  const [visibleParas, setVisibleParas]   = useState<Set<number>>(new Set())
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([])

  // ── Avvio effetti all'mount ───────────────────────────────

  useEffect(() => {
    // Fade-in overlay
    const t0 = setTimeout(() => setVisible(true), 30)

    // Start audio dopo che l'overlay è visibile
    const t1 = setTimeout(() => { start().catch(console.warn) }, 400)

    // Reveal paragrafi in sequenza
    const baseDelay = 1800
    const perParaDelay = 2600
    PARAGRAPHS.forEach((_, i) => {
      const t = setTimeout(
        () => setVisibleParas(prev => new Set([...prev, i])),
        baseDelay + i * perParaDelay,
      )
      timerRefs.current.push(t)
    })

    timerRefs.current.push(t0, t1)
    return () => timerRefs.current.forEach(clearTimeout)
  }, [start])

  // ── Chiusura con fade-out ─────────────────────────────────

  const handleClose = useCallback(() => {
    setClosing(true)
    stop()
    setTimeout(() => onClose(), 800)
  }, [stop, onClose])

  // Escape key chiude
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose])

  // ── Render ────────────────────────────────────────────────

  return (
    <>
      {/* ── Grain overlay (SVG feTurbulence, cinematografico) ── */}
      <svg className="fixed inset-0 pointer-events-none" style={{ display: 'none' }}>
        <filter id="ee-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.65"
            numOctaves="3"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </svg>

      {/* ── Backdrop ─────────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-[9999] flex flex-col items-center justify-between
                   overflow-hidden select-none"
        style={{
          background:  'radial-gradient(ellipse at 50% 60%, #0f0a1e 0%, #050308 100%)',
          opacity:     closing ? 0 : (visible ? 1 : 0),
          transition:  closing
            ? 'opacity 0.8s cubic-bezier(0.4,0,0.2,1)'
            : 'opacity 0.6s cubic-bezier(0.4,0,0.2,1)',
        }}
        onClick={handleClose}
        role="button"
        aria-label="Chiudi"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && handleClose()}
      >
        {/* ── Grain texture overlay ──────────────────────────── */}
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            filter:  'url(#ee-grain)',
            opacity: 0.045,
          }}
        />

        {/* ── Vignetta perimetrale ───────────────────────────── */}
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background: 'radial-gradient(ellipse at 50% 50%, transparent 50%, rgba(0,0,0,0.75) 100%)',
          }}
        />

        {/* ── Micro-particelle ───────────────────────────────── */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          {PARTICLES.map(p => (
            <div
              key={p.id}
              className="absolute rounded-full bg-white"
              style={{
                left:      `${p.x}%`,
                top:       `${p.y}%`,
                width:     `${p.size}px`,
                height:    `${p.size}px`,
                opacity:   p.opacity,
                animation: `ee-float ${p.dur}s ${p.delay}s ease-in-out infinite alternate`,
                '--drift': `${p.drift}px`,
              } as React.CSSProperties}
            />
          ))}
        </div>

        {/* ── Contenuto principale ───────────────────────────── */}
        <div className="relative z-10 flex flex-col items-center w-full h-full px-6 py-12"
             onClick={e => e.stopPropagation()}>

          {/* Testo credits */}
          <div className="flex-1 flex flex-col items-center justify-center max-w-lg w-full">
            <div className="text-center space-y-0">
              {PARAGRAPHS.map((para, i) => (
                <p
                  key={i}
                  className="whitespace-pre-line leading-relaxed"
                  style={{
                    fontSize:   i === 0 ? '1.5rem'  : '1.0rem',
                    fontWeight: i === 0 ? 300        : 300,
                    color:      i === 0 ? 'rgba(255,255,255,0.95)'
                               : i === PARAGRAPHS.length - 1 ? 'rgba(255,255,255,0.5)'
                               : para === '' ? undefined
                               : 'rgba(255,255,255,0.70)',
                    letterSpacing: i === 0 ? '0.12em' : '0.04em',
                    marginBottom: para === '' ? '1.4rem' : '0',
                    opacity:     visibleParas.has(i) ? 1 : 0,
                    transform:   visibleParas.has(i) ? 'translateY(0)' : 'translateY(12px)',
                    transition:  `opacity 2.0s cubic-bezier(0.4,0,0.2,1),
                                  transform 2.0s cubic-bezier(0.4,0,0.2,1)`,
                    fontFamily:  '"Georgia", "Times New Roman", serif',
                    minHeight:   para === '' ? undefined : undefined,
                  }}
                >
                  {para || ' '}
                </p>
              ))}
            </div>
          </div>

          {/* Equalizzatore audio */}
          <div
            className="w-full max-w-md"
            style={{
              height:    '80px',
              opacity:   isPlaying ? 1 : 0.2,
              transition: 'opacity 1.5s ease',
            }}
          >
            <AudioVisualizer bands={bands} isPlaying={isPlaying} />
          </div>

          {/* Indicatore audio */}
          <div
            className="mt-4 flex items-center gap-2"
            style={{
              opacity:    isPlaying ? 0.35 : 0.15,
              transition: 'opacity 1s ease',
            }}
          >
            {[0, 1, 2].map(i => (
              <span
                key={i}
                className="inline-block w-0.5 rounded-full bg-white"
                style={{
                  height:    isPlaying ? `${8 + i * 4}px` : '4px',
                  animation: isPlaying ? `ee-pulse ${0.8 + i * 0.15}s ease-in-out infinite alternate` : 'none',
                  transition: 'height 0.4s ease',
                }}
              />
            ))}
          </div>

          {/* Hint chiusura */}
          <p
            className="mt-6 text-xs tracking-widest uppercase"
            style={{
              color:     'rgba(255,255,255,0.18)',
              opacity:   visibleParas.size >= PARAGRAPHS.length ? 1 : 0,
              transition: 'opacity 2s ease 1s',
              letterSpacing: '0.3em',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            tieni premuto per chiudere
          </p>
        </div>
      </div>

      {/* ── CSS keyframes (iniettati inline via style tag) ─────── */}
      <style>{`
        @keyframes ee-float {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(var(--drift, 20px), -35px) scale(1.4); }
        }
        @keyframes ee-pulse {
          from { transform: scaleY(0.7); }
          to   { transform: scaleY(1.3); }
        }
      `}</style>
    </>
  )
}
