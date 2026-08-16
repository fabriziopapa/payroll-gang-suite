// ============================================================
// PAYROLL GANG SUITE — Card "Aggiornamenti" (Impostazioni, solo admin)
//
// Mostra se il repository ha commit più recenti di quelli installati e
// spiega come applicarli da terminale. È volutamente di SOLA LETTURA: non
// esiste un pulsante che aggiorna.
//
// Il motivo, per chi legge questo file fra un anno: un endpoint che esegue
// `git pull` e ricompila equivale a esecuzione di codice arbitrario per
// chiunque ottenga un token amministratore. Inoltre in produzione il
// servizio gira confinato (filesystem in sola lettura, nessun privilegio):
// non potrebbe comunque scrivere nella docroot né riavviarsi.
// L'aggiornamento si fa con `pgs-update` da terminale — vedi INSTALL_CPANEL.md §12.
// ============================================================

import { useState, useEffect } from 'react'
import { systemApi, type UpdateStatusApi } from '../api/endpoints'
import { showToast } from './ToastManager'

/**
  * Ripiego se il server non fornisce i comandi. Volutamente generico: il
  * percorso di installazione e l'utente di sistema arrivano dal server, che li
  * dà solo agli amministratori. Se fossero scritti qui finirebbero nel bundle
  * JavaScript, che è servito a chiunque senza autenticazione.
  */
const COMANDI_RIPIEGO = ['pgs-update']

function dataBreve(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
}

export default function AggiornamentiCard() {
  const [stato,     setStato]     = useState<UpdateStatusApi | null>(null)
  const [caricando, setCaricando] = useState(true)
  const [aperto,    setAperto]    = useState(false)

  const carica = async (manuale = false): Promise<void> => {
    setCaricando(true)
    try {
      setStato(await systemApi.updateStatus())
      if (manuale) showToast('Stato aggiornamenti ricaricato', 'success')
    } catch {
      // Non è un errore che meriti un allarme: la card mostra "non disponibile".
      setStato(null)
    } finally {
      setCaricando(false)
    }
  }

  useEffect(() => { void carica() }, [])

  const comandi = (stato?.comandi?.length ? stato.comandi : COMANDI_RIPIEGO).join('\n')

  const copia = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(comandi)
      showToast('Comandi copiati', 'success')
    } catch {
      showToast('Copia non riuscita: selezionali a mano', 'warning')
    }
  }

  // ── Intestazione: pallino + titolo, dipendenti dallo stato ──
  const disponibile = stato?.stato === 'disponibile'
  const problema    = stato?.stato === 'controllo-fallito' || stato?.stato === 'obsoleto'

  const pallino =
    disponibile ? 'bg-amber-400'
    : problema  ? 'bg-slate-500'
    : stato?.stato === 'aggiornato' ? 'bg-emerald-400'
    : 'bg-slate-600'

  const titolo =
    caricando   ? 'Verifica aggiornamenti…'
    : disponibile ? 'Aggiornamento disponibile'
    : stato?.stato === 'aggiornato'        ? 'Applicazione aggiornata'
    : stato?.stato === 'obsoleto'          ? 'Controllo aggiornamenti fermo'
    : stato?.stato === 'controllo-fallito' ? 'Controllo aggiornamenti non riuscito'
    : 'Controllo aggiornamenti non attivo'

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${pallino}`} />
            {titolo}
          </h3>
          <p className="text-slate-400 text-xs">
            Confronto fra il codice installato su questo server e il repository.
            Il controllo è di sola lettura: l'aggiornamento si esegue da terminale.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void carica(true)}
          disabled={caricando}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700
                     border border-slate-700 text-slate-200 text-xs font-medium
                     transition disabled:opacity-50"
        >
          {caricando ? 'Verifica…' : 'Verifica ora'}
        </button>
      </div>

      {/* ── Versioni installata / disponibile ─────────────────── */}
      {stato && stato.commitInstallato && (
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div className="bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
            <p className="text-slate-500">Installata</p>
            <p className="text-slate-200 font-medium mt-0.5">
              {stato.versioneInstallata ?? '—'}
            </p>
            <p className="text-slate-500 font-mono mt-0.5">
              {stato.commitInstallato.slice(0, 8)}
            </p>
          </div>
          <div className="bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
            <p className="text-slate-500">Disponibile</p>
            <p className={`font-medium mt-0.5 ${disponibile ? 'text-amber-300' : 'text-slate-200'}`}>
              {stato.versioneDisponibile ?? '—'}
            </p>
            <p className="text-slate-500 font-mono mt-0.5">
              {stato.commitDisponibile?.slice(0, 8) ?? '—'}
            </p>
          </div>
        </div>
      )}

      {/* ── Elenco dei commit non ancora installati ───────────── */}
      {disponibile && stato?.commits && stato.commits.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setAperto(v => !v)}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition"
          >
            {aperto ? '▾' : '▸'} {stato.commitMancanti} commit da installare
          </button>
          {aperto && (
            <ul className="mt-2 space-y-1 max-h-56 overflow-y-auto pr-1">
              {stato.commits.map(c => (
                <li key={c.hash} className="text-xs text-slate-400 flex gap-2">
                  <span className="font-mono text-slate-600 shrink-0">{c.hash.slice(0, 7)}</span>
                  <span className="min-w-0 break-words">{c.messaggio}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Procedura manuale ─────────────────────────────────── */}
      {disponibile && (
        <div className="mt-4 pt-4 border-t border-slate-800">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs text-slate-300 font-medium">
              Come aggiornare — da SSH oppure WHM → Terminal, come root
            </p>
            <button
              type="button"
              onClick={() => void copia()}
              className="shrink-0 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700
                         border border-slate-700 text-slate-300 text-[11px] transition"
            >
              Copia
            </button>
          </div>
          <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px]
                          text-slate-300 font-mono overflow-x-auto whitespace-pre">
{comandi}
          </pre>
          <p className="text-[11px] text-slate-500 mt-2">
            Lo script si ferma prima di modificare qualsiasi cosa se un controllo non passa,
            e se una compilazione fallisce non tocca il sito: resta servita la versione
            attuale. Al termine verifica da solo che l'applicazione risponda.
          </p>
        </div>
      )}

      {/* ── Stati non nominali ────────────────────────────────── */}
      {stato && stato.stato !== 'disponibile' && stato.stato !== 'aggiornato' && (
        <p className="mt-3 text-xs text-slate-400">
          {stato.messaggio ?? 'Stato non disponibile.'}
          {stato.stato === 'obsoleto' && stato.ultimoControllo && (
            <> Ultimo controllo riuscito: {dataBreve(stato.ultimoControllo)}. Verifica il
              timer con <code className="font-mono text-slate-300">systemctl status pgs-update-check.timer</code>.</>
          )}
          {stato.stato === 'non-configurato' && (
            <> Per attivarlo: <code className="font-mono text-slate-300">bash pgs-update-check.sh --install</code>.</>
          )}
        </p>
      )}

      {stato?.ultimoControllo && stato.stato !== 'obsoleto' && (
        <p className="mt-3 text-[11px] text-slate-600">
          Ultimo controllo: {dataBreve(stato.ultimoControllo)} · ramo {stato.ramo ?? 'main'}
        </p>
      )}
    </section>
  )
}
