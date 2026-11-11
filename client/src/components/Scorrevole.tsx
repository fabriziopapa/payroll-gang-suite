// ============================================================
// PAYROLL GANG SUITE — aree che scorrono, senza barre in vista
//
// Dove il contenuto non entra: il bordo sfuma dal lato in cui ce n'è
// ancora, compaiono «‹ ›» per scorrere di lato e «altre righe ↓» in basso;
// la barra è sottile e si vede solo passando col mouse (o con il focus da
// tastiera). Le tabelle con colonne a priorità (classi pgs-p2, pgs-p3)
// nascondono prima le colonne meno importanti e scorrono di lato solo se
// non basta. Stili in index.css (.pgs-*).
// ============================================================

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

export interface StatoScorrimento { sx: boolean; dx: boolean; su: boolean; giu: boolean }
const FERMO: StatoScorrimento = { sx: false, dx: false, su: false, giu: false }

/**
 * Segue un'area che scorre: dove c'è altro contenuto (per le sfumature e i
 * segnali) e, se `adatta`, quante colonne a priorità nascondere (0, 1, 2).
 */
export function useScorrimento<T extends HTMLElement>(adatta = false): { ref: RefObject<T>; stato: StatoScorrimento; stretta: 0 | 1 | 2 } {
  const ref = useRef<T>(null)
  const [stato, setStato] = useState<StatoScorrimento>(FERMO)
  const [stretta, setStretta] = useState<0 | 1 | 2>(0)
  // larghezza che servirebbe per mostrare tutto (0) e per mostrare tutto meno le pgs-p3 (1)
  const serve = useRef<[number, number]>([0, 0])
  const livello = useRef<0 | 1 | 2>(0)
  useEffect(() => {
    const el = ref.current; if (!el) return
    let af = 0
    const misura = () => {
      const testaFissa = !!el.querySelector('thead.sticky')
      if (adatta) {
        const fuori = el.scrollWidth > el.clientWidth + 1
        let l = livello.current
        if (fuori && l < 2) { serve.current[l as 0 | 1] = el.scrollWidth; l = (l + 1) as 1 | 2 }
        else if (!fuori && l > 0 && el.clientWidth >= serve.current[l - 1]!) l = (l - 1) as 0 | 1
        if (l !== livello.current) { livello.current = l; setStretta(l); return } // si rimisura dopo il ridisegno
      }
      const n: StatoScorrimento = {
        sx: el.scrollLeft > 2, dx: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
        su: el.scrollTop > 2, giu: el.scrollTop + el.clientHeight < el.scrollHeight - 2,
      }
      el.style.setProperty('--fl', n.sx ? '40px' : '0px'); el.style.setProperty('--fr', n.dx ? '40px' : '0px')
      el.style.setProperty('--ft', n.su && !testaFissa ? '24px' : '0px'); el.style.setProperty('--fb', n.giu ? '36px' : '0px')
      setStato(p => (p.sx === n.sx && p.dx === n.dx && p.su === n.su && p.giu === n.giu ? p : n))
    }
    const poi = () => { cancelAnimationFrame(af); af = requestAnimationFrame(misura) }
    poi()
    el.addEventListener('scroll', poi, { passive: true })
    const ro = new ResizeObserver(poi)
    ro.observe(el); for (const c of Array.from(el.children)) ro.observe(c)
    // righe aggiunte o tolte (filtri, familiari aperti)
    const mo = new MutationObserver(poi); mo.observe(el, { childList: true, subtree: true })
    return () => { cancelAnimationFrame(af); el.removeEventListener('scroll', poi); ro.disconnect(); mo.disconnect() }
  }, [adatta, stretta])
  return { ref, stato, stretta }
}

const freccia = 'absolute top-1.5 z-10 w-7 h-7 rounded-full bg-slate-800/95 border border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white shadow-lg flex items-center justify-center text-base leading-none'
const pillola = 'absolute left-1/2 -translate-x-1/2 z-10 pointer-events-none text-[11px] px-2 py-0.5 rounded-full bg-slate-800/95 border border-slate-600 text-slate-300 shadow-lg whitespace-nowrap'

/**
 * Contenitore che scorre al posto di <div className="overflow-x-auto …">.
 * Le classi `max-h-*` vanno all'area che scorre, le altre (bordo, angoli) alla cornice.
 */
export function Scorrevole({ children, className = '', adatta = false, etichetta = 'altre righe ↓' }: { children: ReactNode; className?: string; adatta?: boolean; etichetta?: string }) {
  const { ref, stato, stretta } = useScorrimento<HTMLDivElement>(adatta)
  const classi = className.split(/\s+/).filter(Boolean)
  const dentro = classi.filter(c => /^(max-h-|h-)/.test(c)).join(' ')
  const fuori = classi.filter(c => !/^(max-h-|h-|overflow-)/.test(c)).join(' ')
  const vai = (d: -1 | 1) => { const el = ref.current; if (el) el.scrollBy({ left: d * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' }) }
  return (
    <div className={`relative min-w-0 ${fuori}`} data-stretta={stretta || undefined}>
      <div ref={ref} tabIndex={stato.sx || stato.dx || stato.su || stato.giu ? 0 : undefined} className={`pgs-discreto pgs-sfuma overflow-auto focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/60 ${dentro}`}>{children}</div>
      {stato.sx && <button type="button" className={`${freccia} left-1.5`} aria-label="Scorri a sinistra" onClick={() => vai(-1)}>‹</button>}
      {stato.dx && <button type="button" className={`${freccia} right-1.5`} aria-label="Scorri a destra: ci sono altre colonne" onClick={() => vai(1)}>›</button>}
      {stato.giu && <span className={`${pillola} bottom-1.5`} aria-hidden="true">{etichetta}</span>}
    </div>
  )
}
