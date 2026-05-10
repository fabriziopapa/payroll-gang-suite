// ============================================================
// PAYROLL GANG SUITE — Impostazioni
// Sezioni: Scorporo · CSV defaults · Rubrica · Modelli comunicazione
// ============================================================

import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { settingsApi } from '../api/endpoints'
import { showToast } from '../components/ToastManager'
import type { RuoloScorporabile, Contatto, ModelloComunicazione } from '../types'

const TURNSTILE_CONFIGURED = Boolean(import.meta.env['VITE_TURNSTILE_SITE_KEY'])

const RUOLI_SCORPORABILI: RuoloScorporabile[] = ['PA', 'PO', 'RD', 'RU', 'ND']

const inputCls = `px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700
  text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500`

// ── Componente ────────────────────────────────────────────────

export default function ImpostazioniPage() {
  const { settings, setSettings, user } = useStore()

  // ── Tab attiva ────────────────────────────────────────────
  type Tab = 'generali' | 'rubrica' | 'modelli'
  const [tab, setTab] = useState<Tab>('generali')

  // ── Stato locale — sezione Generali ───────────────────────
  const [coefficienti, setCoefficienti] = useState({ ...settings.coefficienti })
  const [csvDefaults, setCsvDefaults]   = useState({ ...settings.csvDefaults })
  const [saving,         setSaving]         = useState(false)
  const [saved,          setSaved]          = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [savingTurnstile, setSavingTurnstile] = useState(false)

  // ── Stato locale — Rubrica ────────────────────────────────
  const [rubrica, setRubrica]         = useState<Contatto[]>(settings.rubrica ?? [])
  const [contNome,  setContNome]      = useState('')
  const [contEmail, setContEmail]     = useState('')
  const [contRuolo, setContRuolo]     = useState('')
  const [savingRub, setSavingRub]     = useState(false)

  // ── Stato locale — Modelli ────────────────────────────────
  const [modelli, setModelli]         = useState<ModelloComunicazione[]>(settings.modelliComunicazione ?? [])
  const [modNome,   setModNome]       = useState('')
  const [modOgg,    setModOgg]        = useState('')
  const [modCorpo,  setModCorpo]      = useState('')
  const [modEdit,   setModEdit]       = useState<string | null>(null)
  const [savingMod, setSavingMod]     = useState(false)

  // Sync locale quando settings cambiano dall'esterno
  useEffect(() => {
    setRubrica(settings.rubrica ?? [])
    setModelli(settings.modelliComunicazione ?? [])
  }, [settings.rubrica, settings.modelliComunicazione])

  // Ascolta il save-modello da ComunicazioneModal
  // Usa getState() per evitare stale closure su `settings` e `modelli`
  useEffect(() => {
    function onSaveModello(e: Event) {
      const nuovoModello = (e as CustomEvent).detail as ModelloComunicazione
      const { settings: s } = useStore.getState()
      const currentModelli = s.modelliComunicazione ?? []
      const updated = [...currentModelli, nuovoModello]
      setModelli(updated)
      settingsApi.update({ modelliComunicazione: updated }).catch(() => {})
      setSettings({ ...s, modelliComunicazione: updated })
    }
    window.addEventListener('payroll:save-modello', onSaveModello)
    return () => window.removeEventListener('payroll:save-modello', onSaveModello)
  }, [setSettings, setModelli])

  // ── Actions Sicurezza ────────────────────────────────────────

  async function handleToggleTurnstile(enabled: boolean) {
    setSavingTurnstile(true)
    try {
      await settingsApi.update({ turnstileEnabled: enabled })
      setSettings({ ...settings, turnstileEnabled: enabled })
      showToast(
        enabled ? 'Protezione Turnstile abilitata' : 'Protezione Turnstile disabilitata',
        'success',
      )
    } catch {
      showToast('Errore nel salvataggio', 'error')
    } finally {
      setSavingTurnstile(false)
    }
  }

  // ── Actions Generali ──────────────────────────────────────

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    try {
      await settingsApi.update({ coefficienti, csvDefaults })
      // Aggiorna solo i campi che questo form gestisce — non toccare rubrica/modelliComunicazione
      setSettings({ ...settings, coefficienti, csvDefaults })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Errore durante il salvataggio')
    } finally { setSaving(false) }
  }

  // ── Actions Rubrica ───────────────────────────────────────

  function addContatto() {
    const e = contEmail.trim()
    const n = contNome.trim() || e
    if (!e || rubrica.some(c => c.email === e)) return
    const updated = [...rubrica, { id: crypto.randomUUID(), nome: n, email: e, ruolo: contRuolo.trim() || undefined }]
    setRubrica(updated)
    setContNome(''); setContEmail(''); setContRuolo('')
    saveRubrica(updated)
  }

  function removeContatto(id: string) {
    const updated = rubrica.filter(c => c.id !== id)
    setRubrica(updated)
    saveRubrica(updated)
  }

  async function saveRubrica(data: Contatto[]) {
    setSavingRub(true)
    try {
      await settingsApi.update({ rubrica: data })
      setSettings({ ...settings, rubrica: data })
    } catch { showToast('Errore nel salvataggio della rubrica', 'error') } finally { setSavingRub(false) }
  }

  // ── Actions Modelli ───────────────────────────────────────

  function addModello() {
    if (!modNome.trim() || !modOgg.trim()) return
    let updated: ModelloComunicazione[]
    if (modEdit) {
      updated = modelli.map(m => m.id === modEdit
        ? { ...m, nome: modNome.trim(), oggetto: modOgg.trim(), corpo: modCorpo }
        : m)
      setModEdit(null)
    } else {
      updated = [...modelli, { id: crypto.randomUUID(), nome: modNome.trim(), oggetto: modOgg.trim(), corpo: modCorpo }]
    }
    setModelli(updated)
    setModNome(''); setModOgg(''); setModCorpo('')
    saveModelli(updated)
  }

  function editModello(m: ModelloComunicazione) {
    setModEdit(m.id); setModNome(m.nome); setModOgg(m.oggetto); setModCorpo(m.corpo)
  }

  function removeModello(id: string) {
    const updated = modelli.filter(m => m.id !== id)
    setModelli(updated)
    saveModelli(updated)
  }

  async function saveModelli(data: ModelloComunicazione[]) {
    setSavingMod(true)
    try {
      await settingsApi.update({ modelliComunicazione: data })
      setSettings({ ...settings, modelliComunicazione: data })
    } catch { showToast('Errore nel salvataggio del modello', 'error') } finally { setSavingMod(false) }
  }

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'generali', label: 'Generali' },
    { id: 'rubrica',  label: `Rubrica (${rubrica.length})` },
    { id: 'modelli',  label: `Modelli comunicazione (${modelli.length})` },
  ]

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto">
      <h2 className="text-xl font-bold text-white mb-4">Impostazioni</h2>

      {/* Tabs */}
      <div className="flex gap-0.5 mb-6">
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition border-b-2
              ${tab === t.id
                ? 'text-white border-indigo-500 bg-slate-800/50'
                : 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800/30'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB GENERALI ──────────────────────────────────────── */}
      {tab === 'generali' && (
        <>
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-4">
            <h3 className="text-sm font-semibold text-white mb-1">Coefficienti di scorporo</h3>
            <p className="text-slate-400 text-xs mb-4">
              Formula: importo netto = importo lordo ÷ (1 + coeff / 100)
            </p>
            <div className="space-y-2">
              {RUOLI_SCORPORABILI.map(ruolo => (
                <div key={ruolo} className="flex items-center gap-3">
                  <span className="font-mono text-sm text-white w-8">{ruolo}</span>
                  <input
                    type="number" step="0.01" min="0" max="100"
                    value={coefficienti[ruolo]}
                    onChange={e => setCoefficienti(prev => ({ ...prev, [ruolo]: parseFloat(e.target.value) || 0 }))}
                    className={`${inputCls} w-28`}
                  />
                  <span className="text-slate-500 text-sm">%</span>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
            <h3 className="text-sm font-semibold text-white mb-1">Parametri CSV default</h3>
            <p className="text-slate-400 text-xs mb-4">
              Copiati in ogni nuovo DettaglioLiquidazione (modificabili per singolo dettaglio)
            </p>
            <div className="space-y-3">
              {([
                ['tipoProvvedimento', 'Tipo Provvedimento', 'text'],
                ['aliquota',          'Aliquota',           'number'],
                ['parti',             'Parti',              'number'],
                ['flagAdempimenti',   'Flag Adempimenti',   'number'],
                ['idContrattoCSA',    'ID Contratto CSA',   'text'],
              ] as const).map(([key, label, type]) => (
                <div key={key} className="flex items-center gap-3">
                  <label className="text-slate-300 text-sm w-44 shrink-0">{label}</label>
                  <input
                    type={type}
                    value={csvDefaults[key]}
                    onChange={e => setCsvDefaults(prev => ({
                      ...prev,
                      [key]: type === 'number' ? parseInt(e.target.value) || 0 : e.target.value,
                    }))}
                    className={`${inputCls} flex-1 max-w-xs`}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Sezione Sicurezza — visibile solo ad admin con Turnstile configurato */}
          {user?.isAdmin && TURNSTILE_CONFIGURED && (
            <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
              <h3 className="text-sm font-semibold text-white mb-1">Sicurezza</h3>
              <p className="text-slate-400 text-xs mb-4">
                Impostazioni di protezione bot e accesso.
              </p>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-slate-300 font-medium">Protezione bot (Cloudflare Turnstile)</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Verifica invisibile anti-bot alla pagina di accesso.
                    Disabilitare solo temporaneamente per debug.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={savingTurnstile}
                  onClick={() => handleToggleTurnstile(!(settings.turnstileEnabled ?? true))}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full
                    border-2 border-transparent transition-colors duration-200
                    focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2
                    focus:ring-offset-slate-900 disabled:opacity-50
                    ${(settings.turnstileEnabled ?? true) ? 'bg-indigo-600' : 'bg-slate-700'}`}
                  role="switch"
                  aria-checked={settings.turnstileEnabled ?? true}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white
                      shadow transform transition duration-200
                      ${(settings.turnstileEnabled ?? true) ? 'translate-x-5' : 'translate-x-0'}`}
                  />
                </button>
              </div>
            </section>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600
                         hover:bg-indigo-500 text-white text-sm font-medium transition
                         disabled:opacity-50"
            >
              {saving ? (
                <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>Salvataggio…</>
              ) : 'Salva impostazioni'}
            </button>
            {saved  && <span className="text-green-400 text-sm">✓ Salvato</span>}
            {error  && <span className="text-red-400 text-sm">{error}</span>}
          </div>
        </>
      )}

      {/* ── TAB RUBRICA ────────────────────────────────────────── */}
      {tab === 'rubrica' && (
        <>
          <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-4">
            {rubrica.length === 0 ? (
              <p className="px-5 py-6 text-center text-slate-500 text-sm">
                Nessun contatto. Aggiungi il primo usando il form qui sotto.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left px-4 py-2.5 text-slate-400 text-xs font-medium">Nome</th>
                    <th className="text-left px-4 py-2.5 text-slate-400 text-xs font-medium">Email</th>
                    <th className="text-left px-4 py-2.5 text-slate-400 text-xs font-medium hidden sm:table-cell">Ruolo</th>
                    <th className="w-10"/>
                  </tr>
                </thead>
                <tbody>
                  {rubrica.map(c => (
                    <tr key={c.id} className="border-b border-slate-800/50 hover:bg-slate-800/20 group">
                      <td className="px-4 py-2.5 text-white">{c.nome}</td>
                      <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">{c.email}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs hidden sm:table-cell">{c.ruolo ?? '—'}</td>
                      <td className="px-2 py-2">
                        <button
                          onClick={() => removeContatto(c.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500
                                     hover:text-red-400 hover:bg-red-950/30 transition"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Form aggiunta contatto */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Aggiungi contatto</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Nome *</label>
                <input
                  type="text" placeholder="Mario Rossi" value={contNome}
                  onChange={e => setContNome(e.target.value)}
                  className={`${inputCls} w-full`}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Email *</label>
                <input
                  type="email" placeholder="mario@ateneo.it" value={contEmail}
                  onChange={e => setContEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addContatto())}
                  className={`${inputCls} w-full`}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Ruolo (opz.)</label>
                <input
                  type="text" placeholder="es. Ufficio Stipendi" value={contRuolo}
                  onChange={e => setContRuolo(e.target.value)}
                  className={`${inputCls} w-full`}
                />
              </div>
            </div>
            <button
              onClick={addContatto}
              disabled={!contEmail.trim() || savingRub}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                         text-white text-sm font-medium transition disabled:opacity-50"
            >
              {savingRub ? 'Salvataggio…' : 'Aggiungi contatto'}
            </button>
          </div>
        </>
      )}

      {/* ── TAB MODELLI ────────────────────────────────────────── */}
      {tab === 'modelli' && (
        <>
          <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-4">
            {modelli.length === 0 ? (
              <p className="px-5 py-6 text-center text-slate-500 text-sm">
                Nessun modello. Crea il primo usando il form qui sotto.
              </p>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {modelli.map(m => (
                  <div key={m.id} className="px-4 py-3 hover:bg-slate-800/20 group flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{m.nome}</p>
                      <p className="text-slate-500 text-xs mt-0.5 truncate">{m.oggetto}</p>
                      {m.corpo && (
                        <p className="text-slate-600 text-xs mt-0.5 truncate max-w-sm">{m.corpo}</p>
                      )}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                      <button
                        onClick={() => editModello(m)}
                        className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-700 transition"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                        </svg>
                      </button>
                      <button
                        onClick={() => removeModello(m.id)}
                        className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-950/30 transition"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Form aggiunta / modifica modello */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-3">
              {modEdit ? 'Modifica modello' : 'Nuovo modello'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Nome modello *</label>
                <input
                  type="text" placeholder="es. Comunicazione TFA Sostegno" value={modNome}
                  onChange={e => setModNome(e.target.value)}
                  className={`${inputCls} w-full`}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Oggetto email *</label>
                <input
                  type="text" placeholder="es. Liquidazione compensi TFA Sostegno" value={modOgg}
                  onChange={e => setModOgg(e.target.value)}
                  className={`${inputCls} w-full`}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Corpo (opz.)</label>
                <textarea
                  rows={4} placeholder="Testo del messaggio…" value={modCorpo}
                  onChange={e => setModCorpo(e.target.value)}
                  className={`${inputCls} w-full`}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={addModello}
                disabled={!modNome.trim() || !modOgg.trim() || savingMod}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                           text-white text-sm font-medium transition disabled:opacity-50"
              >
                {savingMod ? 'Salvataggio…' : modEdit ? 'Aggiorna modello' : 'Aggiungi modello'}
              </button>
              {modEdit && (
                <button
                  type="button"
                  onClick={() => { setModEdit(null); setModNome(''); setModOgg(''); setModCorpo('') }}
                  className="text-slate-500 hover:text-slate-300 text-sm transition"
                >
                  Annulla
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
