// ============================================================
// PAYROLL GANG SUITE — AuditPage (solo admin)
// Lettura leggibile del registro audit: traduce azioni e
// decodifica i `dettagli` senza dover interrogare il DB.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { auditApi, type AuditEntryApi } from '../api/endpoints'
import { useDebounce } from '../hooks/useDebounce'
import Pagination from '../components/Pagination'

type Tono = 'neutro' | 'ok' | 'warn' | 'danger' | 'info'

interface AzioneMeta { label: string; tono: Tono }

// Dizionario azioni → etichetta italiana + tono (colore)
const AZIONE_META: Record<string, AzioneMeta> = {
  LOGIN_SUCCESS:                 { label: 'Accesso riuscito',            tono: 'ok' },
  LOGIN_FAILED:                  { label: 'Accesso fallito',             tono: 'danger' },
  USER_REGISTERED:               { label: 'Utente registrato',           tono: 'info' },
  USER_ACTIVATED:                { label: 'Utente attivato',             tono: 'ok' },
  USER_DELETED:                  { label: 'Utente eliminato',            tono: 'danger' },
  USER_ENABLED:                  { label: 'Utente abilitato',            tono: 'ok' },
  USER_DISABLED:                 { label: 'Utente disabilitato',         tono: 'warn' },
  USER_UNLOCKED:                 { label: 'Utente sbloccato',            tono: 'info' },
  USER_PROMOTED_ADMIN:           { label: 'Promosso ad admin',           tono: 'warn' },
  USER_DEMOTED_ADMIN:            { label: 'Rimosso da admin',            tono: 'warn' },
  USER_QR_REGENERATED:           { label: 'QR/TOTP rigenerato',          tono: 'info' },
  REFRESH_FINGERPRINT_CHANGED:   { label: 'Fingerprint sessione cambiato', tono: 'warn' },
  REFRESH_TOKEN_THEFT_SUSPECTED: { label: 'Sospetto furto token',        tono: 'danger' },
  SETTINGS_UPDATED:              { label: 'Impostazioni aggiornate',     tono: 'info' },
  CERTIFICATO_CREATO:            { label: 'Certificato creato',          tono: 'ok' },
  CERTIFICATO_SCARICATO:         { label: 'Certificato scaricato',       tono: 'info' },
  CERTIFICATO_ELIMINATO:         { label: 'Certificato eliminato',       tono: 'danger' },
  CINECA_CF_LOOKUP:              { label: 'Lookup CF CINECA',            tono: 'info' },
  PDF_REGION_TEMPLATE_CREATO:    { label: 'Template PDF creato',         tono: 'ok' },
  PDF_REGION_TEMPLATE_VERSIONATO:{ label: 'Template PDF versionato',     tono: 'info' },
  PDF_REGION_TEMPLATE_ELIMINATO: { label: 'Template PDF eliminato',      tono: 'danger' },
  PDF_REGION_TEMPLATE_ESTRATTO:  { label: 'Template PDF estratto',       tono: 'info' },
  TEMPLATE_CREATO:               { label: 'Template certificato creato', tono: 'ok' },
  TEMPLATE_MODIFICATO:           { label: 'Template certificato modificato', tono: 'info' },
  TEMPLATE_ELIMINATO:            { label: 'Template certificato eliminato', tono: 'danger' },
}

const TONO_CLS: Record<Tono, string> = {
  neutro: 'text-slate-300 border-slate-700 bg-slate-800/50',
  ok:     'text-emerald-400 border-emerald-800 bg-emerald-900/20',
  info:   'text-indigo-400 border-indigo-800 bg-indigo-900/20',
  warn:   'text-amber-400 border-amber-800 bg-amber-900/20',
  danger: 'text-red-400 border-red-800 bg-red-900/20',
}

// Etichette leggibili per le entità
const ENTITA_LABEL: Record<string, string> = {
  users:                'Utente',
  certificato:          'Certificato',
  cineca:               'CINECA',
  app_settings:         'Impostazioni',
  templato_pdf_region:  'Template PDF',
  templato_certificato: 'Template certificato',
}

function metaFor(azione: string): AzioneMeta {
  return AZIONE_META[azione] ?? { label: azione, tono: 'neutro' }
}

/** Decodifica i `dettagli` JSON in una frase leggibile. */
function describeDettagli(azione: string, dettagli: unknown): string {
  if (dettagli == null || typeof dettagli !== 'object') return ''
  const d = dettagli as Record<string, unknown>
  const val = (k: string) => (d[k] == null ? '' : String(d[k]))

  switch (azione) {
    case 'LOGIN_FAILED':
      return d.reason ? `Motivo: ${val('reason')}` : ''
    case 'SETTINGS_UPDATED':
      if (Array.isArray(d.chiavi)) return `Chiavi: ${(d.chiavi as unknown[]).join(', ')}`
      return d.chiave ? `Chiave: ${val('chiave')}` : ''
    case 'CERTIFICATO_CREATO':
    case 'CERTIFICATO_SCARICATO':
    case 'CERTIFICATO_ELIMINATO': {
      const parts: string[] = []
      if (d.protocollo) parts.push(`Protocollo ${val('protocollo')}`)
      if (d.matricola)  parts.push(`matricola ${val('matricola')}`)
      if (d.anno)       parts.push(`anno ${val('anno')}`)
      return parts.join(' · ')
    }
    case 'CINECA_CF_LOOKUP': {
      const parts: string[] = []
      if (d.endpoint) parts.push(`Endpoint ${val('endpoint')}`)
      if (d.matricola) parts.push(`matricola ${val('matricola')}`)
      if (d.count != null) parts.push(`${val('count')} risultati`)
      return parts.join(' · ')
    }
    case 'PDF_REGION_TEMPLATE_CREATO':
    case 'PDF_REGION_TEMPLATE_VERSIONATO':
    case 'PDF_REGION_TEMPLATE_ELIMINATO':
    case 'PDF_REGION_TEMPLATE_ESTRATTO': {
      const parts: string[] = []
      if (d.nome)      parts.push(`«${val('nome')}»`)
      if (d.versione)  parts.push(`v${val('versione')}`)
      if (d.matricola) parts.push(`matricola ${val('matricola')}`)
      if (d.warnings != null && Number(d.warnings) > 0) parts.push(`${val('warnings')} warning`)
      if (d.errors != null && Number(d.errors) > 0)     parts.push(`${val('errors')} errori`)
      return parts.join(' · ')
    }
    case 'TEMPLATE_CREATO':
    case 'TEMPLATE_MODIFICATO':
    case 'TEMPLATE_ELIMINATO':
      return d.nome ? `«${val('nome')}»` : ''
  }

  // Generico: coppie chiave: valore (escludendo hash tecnici lunghi)
  return Object.entries(d)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join(' · ')
}

function formatTs(iso: string): string {
  const dt = new Date(iso)
  return dt.toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export default function AuditPage() {
  const { user, navigate } = useStore()

  // Guard: solo admin
  useEffect(() => {
    if (!user?.isAdmin) navigate('dashboard')
  }, [user, navigate])

  const [rows, setRows]         = useState<AuditEntryApi[]>([])
  const [total, setTotal]       = useState(0)
  const [azioni, setAzioni]     = useState<string[]>([])
  const [loading, setLoading]   = useState(false)

  const [azione, setAzione]     = useState('')
  const [query, setQuery]       = useState('')
  const debQuery                = useDebounce(query, 300)
  const [from, setFrom]         = useState('')
  const [to, setTo]             = useState('')
  const [page, setPage]         = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [expanded, setExpanded] = useState<number | null>(null)

  // Carica elenco azioni per il filtro (una volta)
  useEffect(() => {
    auditApi.azioni().then(setAzioni).catch(() => {})
  }, [])

  // Reset pagina sui filtri
  useEffect(() => { setPage(1) }, [azione, debQuery, from, to, pageSize])

  // Carica righe
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    auditApi.list({
      page, pageSize,
      azione: azione || undefined,
      search: debQuery || undefined,
      from:   from ? new Date(from).toISOString() : undefined,
      to:     to ? new Date(to + 'T23:59:59').toISOString() : undefined,
    })
      .then(res => { if (!cancelled) { setRows(res.rows); setTotal(res.total) } })
      .catch(() => { if (!cancelled) { setRows([]); setTotal(0) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [page, pageSize, azione, debQuery, from, to])

  const azioniOpts = useMemo(
    () => azioni.map(a => ({ value: a, label: metaFor(a).label })).sort((x, y) => x.label.localeCompare(y.label)),
    [azioni],
  )

  if (!user?.isAdmin) return null

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h2 className="text-xl font-bold text-white">Audit</h2>
        <p className="text-slate-400 text-sm mt-0.5">
          Registro delle operazioni — sola lettura, solo amministratori.
        </p>
      </div>

      {/* Filtri */}
      <div className="flex flex-wrap gap-3 mb-4 text-sm">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Cerca utente, entità, IP…"
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-800 border border-slate-700
                       text-white text-sm placeholder:text-slate-500
                       focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>

        <select
          value={azione}
          onChange={e => setAzione(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-sm
                     focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">Tutte le azioni</option>
          {azioniOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <label className="flex items-center gap-1.5 text-slate-400">
          Dal
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="px-2 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-sm
                       [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </label>
        <label className="flex items-center gap-1.5 text-slate-400">
          Al
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="px-2 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-sm
                       [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </label>

        {(azione || query || from || to) && (
          <button
            onClick={() => { setAzione(''); setQuery(''); setFrom(''); setTo('') }}
            className="px-3 py-2 rounded-lg text-slate-400 hover:text-white text-sm transition"
          >
            Azzera filtri
          </button>
        )}
      </div>

      {/* Tabella */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <svg className="animate-spin w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm">Nessuna voce di audit per i filtri correnti.</div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500">
                  <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Data / ora</th>
                  <th className="px-3 py-2.5 text-left font-medium">Utente</th>
                  <th className="px-3 py-2.5 text-left font-medium">Azione</th>
                  <th className="px-3 py-2.5 text-left font-medium">Entità</th>
                  <th className="px-3 py-2.5 text-left font-medium">Dettagli</th>
                  <th className="px-3 py-2.5 text-left font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const meta = metaFor(r.azione)
                  const desc = describeDettagli(r.azione, r.dettagli)
                  const isOpen = expanded === r.id
                  const entitaTxt = r.entita ? (ENTITA_LABEL[r.entita] ?? r.entita) : '—'
                  return (
                    <tr key={r.id}
                      onClick={() => setExpanded(isOpen ? null : r.id)}
                      className="border-b border-slate-800/50 hover:bg-slate-800/40 transition cursor-pointer align-top">
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap font-mono">{formatTs(r.timestamp)}</td>
                      <td className="px-3 py-2 text-slate-300">
                        {r.username ?? <span className="text-slate-600 italic">sistema / anonimo</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-1.5 py-0.5 rounded-full border ${TONO_CLS[meta.tono]}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-400">
                        {entitaTxt}
                        {r.entitaId && <span className="block text-slate-600 font-mono text-[10px] truncate max-w-[140px]">{r.entitaId}</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-300 max-w-[280px]">
                        <span className="break-words">{desc || <span className="text-slate-600">—</span>}</span>
                        {isOpen && (r.dettagli != null || r.userAgent) && (
                          <div className="mt-1.5 p-2 rounded bg-slate-950/60 border border-slate-800 space-y-1">
                            {r.dettagli != null && (
                              <pre className="text-[10px] text-slate-400 whitespace-pre-wrap break-all font-mono">
                                {JSON.stringify(r.dettagli, null, 2)}
                              </pre>
                            )}
                            {r.userAgent && (
                              <p className="text-[10px] text-slate-500 break-all">User-Agent: {r.userAgent}</p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500 font-mono whitespace-nowrap">{r.ip ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            total={total}
            pageSize={pageSize}
            page={page}
            onPageChange={setPage}
            onPageSizeChange={s => { setPageSize(s); setPage(1) }}
          />
        </div>
      )}

      <p className="text-xs text-slate-600 mt-3">
        Clicca una riga per vedere i dettagli grezzi (JSON) e lo User-Agent. Il registro è append-only.
      </p>
    </div>
  )
}
