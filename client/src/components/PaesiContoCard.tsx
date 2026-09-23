// ============================================================
// PAYROLL GANG SUITE — Card "Paesi e area del conto" (Impostazioni)
//
// L'elenco dei paesi dell'IBAN con la loro area (SEPA / EXTRA_UE), come lo
// tiene PGS (tabella paesi_conto, migrazione 0019). Tutti lo vedono; solo
// un amministratore lo cambia. Un cambio non sovrascrive: chiude la riga
// in vigore e ne apre una nuova, e la storia resta visibile qui sotto.
//
// Nessun dato personale: solo codici paese. I nomi in italiano li da' il
// browser (Intl.DisplayNames), senza chiamate esterne.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { paesiContoApi, type PaeseContoApi } from '../api/endpoints'
import { ApiError } from '../api/client'
import { showToast } from './ToastManager'

/** L'elenco ufficiale dei paesi SEPA, pubblicato dall'European Payments Council. */
const FONTE_PRIMARIA = 'https://www.europeanpaymentscouncil.eu/document-library/other/epc-list-sepa-scheme-countries'

const nomi = (() => {
  try { return new Intl.DisplayNames(['it'], { type: 'region' }) } catch { return null }
})()
function nomePaese(codice: string): string {
  try { return nomi?.of(codice) ?? codice } catch { return codice }
}
function gg(iso: string | null): string {
  if (!iso) return ''
  const [a, m, d] = iso.split('-')
  return a && m && d ? `${d}/${m}/${a}` : iso
}

export default function PaesiContoCard({ admin }: { admin: boolean }) {
  const [inVigore, setInVigore] = useState<PaeseContoApi[]>([])
  const [storia,   setStoria]   = useState<PaeseContoApi[]>([])
  const [caricando, setCaricando] = useState(true)
  const [aperto,   setAperto]   = useState(false)
  const [codice,   setCodice]   = useState('')
  const [area,     setArea]     = useState<'SEPA' | 'EXTRA_UE'>('SEPA')
  const [dal,      setDal]      = useState('')
  const [nota,     setNota]     = useState('')
  const [salvando, setSalvando] = useState(false)

  async function carica() {
    setCaricando(true)
    try {
      const r = await paesiContoApi.elenco()
      setInVigore(r.inVigore)
      setStoria(r.storia)
    } catch {
      showToast('Elenco dei paesi non disponibile.', 'error')
    } finally {
      setCaricando(false)
    }
  }
  useEffect(() => { void carica() }, [])

  const sepa  = useMemo(() => inVigore.filter(p => p.area === 'SEPA'), [inVigore])
  const extra = useMemo(() => inVigore.filter(p => p.area === 'EXTRA_UE'), [inVigore])
  const cambi = useMemo(() => storia.filter(p => p.fonte === 'manuale' || p.validoAl !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20), [storia])

  const codiceOk = /^[A-Za-z]{2}$/.test(codice.trim()) && codice.trim().toUpperCase() !== 'IT'
  const valido = codiceOk && nota.trim().length >= 3 && (dal === '' || /^\d{4}-\d{2}-\d{2}$/.test(dal))

  async function salva() {
    if (!valido || salvando) return
    setSalvando(true)
    try {
      await paesiContoApi.cambia({
        codice: codice.trim().toUpperCase(), area, nota: nota.trim(),
        ...(dal ? { validoDal: dal } : {}),
      })
      showToast(`${codice.trim().toUpperCase()} ora è ${area === 'SEPA' ? 'SEPA' : 'EXTRA UE'}.`, 'success')
      setCodice(''); setNota(''); setDal('')
      await carica()
    } catch (err) {
      const msg = err instanceof ApiError
        ? err.code === 'AREA_GIA_IN_VIGORE' ? 'Il paese ha già questa area.'
        : err.code === 'DATA_NON_VALIDA'    ? 'La data deve essere successiva a quella della riga in vigore.'
        : err.code === 'IT_NON_MODIFICABILE' ? 'IT è sempre un gruppo a sé.'
        : `Errore (${err.status})`
        : 'Errore di rete'
      showToast(msg, 'error')
    } finally {
      setSalvando(false)
    }
  }

  const chip = (p: PaeseContoApi) => (
    <span key={p.id} title={`${nomePaese(p.codice)} · dal ${gg(p.validoDal)} · ${p.fonte}`}
          className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
      {p.codice}
    </span>
  )

  const campo = 'px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-indigo-500'

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-4">
      <h3 className="text-sm font-semibold text-white mb-1">Paesi e area del conto</h3>
      <p className="text-slate-400 text-xs mb-3">
        L’area del conto (IT / SEPA / EXTRA UE) si calcola dal paese dell’IBAN con questo elenco.
        Un paese che l’elenco non conosce vale EXTRA UE. Elenco iniziale: EPC409-09 v8.0 del 24/12/2025.
      </p>

      <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 mb-4">
        <p className="text-xs text-amber-200">
          <strong>In fase di sviluppo.</strong> L’elenco si aggiorna per ora solo a mano, da qui.
          Si stanno implementando anche i singoli codici SWIFT (BIC), per sapere se una banca è
          raggiungibile in SEPA o è EXTRA UE.
        </p>
      </div>

      {caricando ? (
        <p className="text-xs text-slate-500">Caricamento…</p>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-xs text-slate-400 mb-1.5">SEPA ({sepa.length}) — più IT, che fa gruppo a sé</p>
            <div className="flex flex-wrap gap-1.5">{sepa.map(chip)}</div>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1.5">EXTRA UE segnati a mano ({extra.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {extra.length === 0 ? <span className="text-xs text-slate-600">nessuno</span> : extra.map(chip)}
            </div>
          </div>

          {cambi.length > 0 && (
            <div>
              <button type="button" onClick={() => setAperto(a => !a)}
                      className="text-xs text-slate-400 hover:text-slate-200">
                {aperto ? '▾' : '▸'} Storia dei cambi ({cambi.length})
              </button>
              {aperto && (
                <ul className="mt-2 space-y-1">
                  {cambi.map(p => (
                    <li key={p.id} className="text-xs text-slate-400">
                      <span className="font-mono text-slate-300">{p.codice}</span> {nomePaese(p.codice)} ·{' '}
                      {p.area === 'SEPA' ? 'SEPA' : 'EXTRA UE'} dal {gg(p.validoDal)}
                      {p.validoAl ? ` al ${gg(p.validoAl)}` : ' (in vigore)'} · {p.fonte}
                      {p.nota ? ` — ${p.nota}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {admin && (
            <div className="border-t border-slate-800 pt-3">
              <p className="text-xs text-slate-400 mb-2">Cambia l’area di un paese</p>
              <div className="flex flex-wrap items-center gap-2">
                <input value={codice} onChange={e => setCodice(e.target.value.slice(0, 2))}
                       placeholder="codice" className={campo + ' w-20 font-mono uppercase'} />
                <span className="text-xs text-slate-500 w-32 truncate">
                  {codiceOk ? nomePaese(codice.trim().toUpperCase()) : ''}
                </span>
                <select value={area} onChange={e => setArea(e.target.value as 'SEPA' | 'EXTRA_UE')}
                        className={campo}>
                  <option value="SEPA">SEPA</option>
                  <option value="EXTRA_UE">EXTRA UE</option>
                </select>
                <input type="date" value={dal} onChange={e => setDal(e.target.value)}
                       title="Da quando vale (vuoto = oggi)" className={campo} />
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <input value={nota} onChange={e => setNota(e.target.value)} maxLength={300}
                       placeholder="motivo e fonte (obbligatorio)" className={campo + ' flex-1 min-w-[14rem]'} />
                <button type="button" onClick={() => void salva()} disabled={!valido || salvando}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white
                                   hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed">
                  {salvando ? 'Salvataggio…' : 'Salva'}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Il cambio non cancella la riga precedente: la chiude al giorno prima e resta nella storia.
              </p>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-slate-500 border-t border-slate-800 mt-4 pt-3">
        Fonte primaria:{' '}
        <a href={FONTE_PRIMARIA} target="_blank" rel="noopener noreferrer"
           className="text-indigo-300 hover:text-indigo-200 underline decoration-dotted break-all">
          EPC — EPC List of SEPA Scheme Countries (EPC409-09)
        </a>
        <span className="block mt-1">
          Da consultare a mano quando serve: finché non si trova un modo affidabile per
          leggerla in automatico, i cambi a questo elenco si fanno da qui, confrontandoli con
          l’ultima versione pubblicata dall’EPC.
        </span>
      </p>
    </section>
  )
}
