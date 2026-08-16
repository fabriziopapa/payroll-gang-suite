// ============================================================
// PAYROLL GANG SUITE — Routes Sistema (/api/v1/system)
//
// Stato aggiornamenti, in SOLA LETTURA. Il server non esegue git, non
// compila e non riavvia nulla: legge un file JSON scritto fuori banda da
// `pgs-update-check.sh` (timer systemd) e lo espone agli amministratori.
//
// La scelta è deliberata. Un endpoint che aggiorna l'applicazione sarebbe
// esecuzione di codice arbitrario per chiunque ottenga un token admin o
// sfrutti una falla in una dipendenza; inoltre il servizio gira confinato,
// con filesystem in sola lettura e senza privilegi, quindi non potrebbe
// comunque né scrivere nella docroot né riavviarsi. L'aggiornamento resta
// `pgs-update` da terminale: vedi INSTALL_CPANEL.md §12.
// ============================================================

import type { FastifyInstance } from 'fastify'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { userInfo } from 'node:os'
import { z } from 'zod'
import { requireAdmin } from '../middleware/authenticate.js'
import { env } from '../config/env.js'

/** Oltre queste ore il file di stato è considerato vecchio: il timer non gira. */
const ORE_PRIMA_DI_CONSIDERARLO_OBSOLETO = 24

/**
 * Comandi da mostrare all'amministratore per aggiornare.
 *
 * Vengono calcolati QUI, lato server, e non scritti nel client per due motivi.
 * Primo: contengono il percorso di installazione e il nome dell'utente di
 * sistema, che nel bundle finirebbero in chiaro dentro un file JavaScript
 * scaricabile da chiunque senza autenticazione. Secondo: essendo generati dal
 * processo e non letti dal file di stato, un file di stato manomesso non può
 * far comparire all'operatore un comando diverso da questi.
 *
 * WorkingDirectory del servizio è <repo>/server, quindi la radice del
 * repository è la directory superiore.
 */
function comandiAggiornamento(): string[] {
  let radice: string
  let utente: string
  try {
    radice = dirname(process.cwd())
    utente = userInfo().username
  } catch {
    return ['pgs-update']
  }
  return [
    `sudo -H -u ${utente} git -C ${radice} pull`,
    'pgs-update',
  ]
}

/**
 * Forma del file scritto da pgs-update-check.sh. Validata perché è comunque
 * un input esterno al processo: se il formato cambia, meglio uno stato
 * "non-disponibile" esplicito che un errore 500 opaco.
 */
const statoFileSchema = z.object({
  versione:            z.number(),
  ultimoControllo:     z.string(),
  ramo:                z.string(),
  commitInstallato:    z.string(),
  commitDisponibile:   z.string(),
  versioneInstallata:  z.string().nullable(),
  versioneDisponibile: z.string().nullable(),
  commitMancanti:      z.number(),
  commits: z.array(z.object({
    hash:      z.string(),
    messaggio: z.string(),
    data:      z.string(),
  })),
  errore: z.string().nullable(),
})

/** Stati possibili, pensati per essere mostrati così come sono all'operatore. */
type Stato =
  | 'non-configurato'   // il controllo non è installato su questo server
  | 'aggiornato'        // nessun commit più recente
  | 'disponibile'       // ci sono commit da installare
  | 'controllo-fallito' // il timer gira ma non riesce a contattare il remoto
  | 'obsoleto'          // l'ultimo controllo è troppo vecchio: timer fermo?

export async function systemRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/system/update-status
   * Solo amministratori: espone hash di commit e messaggi, cioè informazioni
   * sull'infrastruttura che non riguardano gli altri utenti.
   */
  app.get('/update-status', {
    preHandler: [app.authenticate, requireAdmin],
  }, async (_req, reply) => {

    const percorso = env.UPDATE_STATUS_FILE
    if (!percorso) {
      return reply.send({
        stato: 'non-configurato' satisfies Stato,
        messaggio: 'Controllo aggiornamenti non attivo su questo server.',
      })
    }

    let grezzo: string
    try {
      grezzo = await readFile(percorso, 'utf-8')
    } catch {
      // File assente: lo script non è mai stato eseguito, oppure il servizio
      // non ha il permesso di leggerlo. In entrambi i casi non è un errore
      // dell'applicazione e non ha senso restituire 500.
      return reply.send({
        stato: 'non-configurato' satisfies Stato,
        messaggio: 'Controllo aggiornamenti non ancora eseguito su questo server.',
      })
    }

    const parsed = statoFileSchema.safeParse(safeJsonParse(grezzo))
    if (!parsed.success) {
      return reply.send({
        stato: 'controllo-fallito' satisfies Stato,
        messaggio: 'Il file di stato degli aggiornamenti non è leggibile.',
      })
    }
    const s = parsed.data

    const oreTrascorse =
      (Date.now() - new Date(s.ultimoControllo).getTime()) / 3_600_000

    const stato: Stato =
      s.errore                                          ? 'controllo-fallito'
      : oreTrascorse > ORE_PRIMA_DI_CONSIDERARLO_OBSOLETO ? 'obsoleto'
      : s.commitMancanti > 0                            ? 'disponibile'
      :                                                   'aggiornato'

    return reply.send({
      stato,
      comandi:             stato === 'disponibile' ? comandiAggiornamento() : undefined,
      ramo:                s.ramo,
      ultimoControllo:     s.ultimoControllo,
      commitInstallato:    s.commitInstallato,
      commitDisponibile:   s.commitDisponibile,
      versioneInstallata:  s.versioneInstallata,
      versioneDisponibile: s.versioneDisponibile,
      commitMancanti:      s.commitMancanti,
      commits:             s.commits,
      messaggio:           s.errore ?? undefined,
    })
  })
}

function safeJsonParse(testo: string): unknown {
  try { return JSON.parse(testo) } catch { return null }
}
