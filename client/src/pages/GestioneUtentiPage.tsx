// ============================================================
// PAYROLL GANG SUITE — Gestione Utenti (admin only)
// Crea / visualizza / abilita / elimina utenti
// ============================================================

import React, { useEffect, useState, useRef } from 'react'
import { usersApi, authApi, type UserManagementEntry } from '../api/endpoints'
import { useStore } from '../store/useStore'
import { showToast } from '../components/ToastManager'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ApiError } from '../api/client'

// ── Tipi locali ───────────────────────────────────────────────

interface NewUserForm {
  username: string
  isAdmin:  boolean
}

// ── Componente ────────────────────────────────────────────────

export default function GestioneUtentiPage() {
  const currentUser = useStore(s => s.user)

  const [users, setUsers]           = useState<UserManagementEntry[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)

  // Nuovo utente
  const [showNewForm, setShowNewForm] = useState(false)
  const [form, setForm]               = useState<NewUserForm>({ username: '', isAdmin: false })
  const [creating, setCreating]       = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Risultato creazione / regen QR (shape comune)
  const [qrResult, setQrResult]     = useState<{
    qrCodeUrl: string
    backupKey: string
    emailSent: boolean
    type:      'create' | 'regen'
  } | null>(null)

  // Operazioni in corso per singolo utente
  const [pending, setPending]       = useState<Record<string, boolean>>({})
  const [confirmAdmin,  setConfirmAdmin]  = useState<UserManagementEntry | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<UserManagementEntry | null>(null)
  const [confirmRegen,  setConfirmRegen]  = useState<UserManagementEntry | null>(null)

  const emailRef = useRef<HTMLInputElement>(null)

  // ── Carica lista ─────────────────────────────────────────────
  useEffect(() => {
    loadUsers()
  }, [])

  useEffect(() => {
    if (showNewForm) emailRef.current?.focus()
  }, [showNewForm])

  async function loadUsers() {
    setLoading(true)
    setError(null)
    try {
      const data = await usersApi.list()
      setUsers(data)
    } catch {
      setError('Impossibile caricare la lista utenti.')
    } finally {
      setLoading(false)
    }
  }

  // ── Crea utente ───────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.username.trim() || creating) return

    setCreating(true)
    setCreateError(null)
    try {
      const result = await authApi.register(form.username.trim(), form.isAdmin)
      setQrResult({ qrCodeUrl: result.qrCodeUrl, backupKey: result.backupKey, emailSent: result.emailSent, type: 'create' })
      setShowNewForm(false)
      setForm({ username: '', isAdmin: false })
      await loadUsers()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'ERRORE'
      setCreateError(
        code === 'USERNAME_TAKEN'
          ? 'Email già registrata.'
          : `Errore: ${code}`,
      )
    } finally {
      setCreating(false)
    }
  }

  // ── Toggle attivo ────────────────────────────────────────────
  async function handleToggleActive(user: UserManagementEntry) {
    setPending(p => ({ ...p, [user.id]: true }))
    try {
      await usersApi.setActive(user.id, !user.isActive)
      setUsers(list =>
        list.map(u => u.id === user.id ? { ...u, isActive: !u.isActive } : u),
      )
    } catch {
      showToast('Errore modifica stato utente', 'error')
      await loadUsers()
    } finally {
      setPending(p => ({ ...p, [user.id]: false }))
    }
  }

  // ── Toggle admin ─────────────────────────────────────────────
  async function doToggleAdmin(user: UserManagementEntry) {
    setPending(p => ({ ...p, [user.id]: true }))
    try {
      await usersApi.setAdmin(user.id, !user.isAdmin)
      setUsers(list =>
        list.map(u => u.id === user.id ? { ...u, isAdmin: !u.isAdmin } : u),
      )
    } catch (err) {
      const code = err instanceof ApiError ? err.code : (err as Error).message ?? 'ERRORE'
      if (code === 'CANNOT_DEMOTE_SUPERADMIN') {
        showToast('L\'utente "admin" non può essere declassato.', 'warning')
      } else {
        showToast(`Impossibile modificare il ruolo: ${code}`, 'error')
      }
      await loadUsers()
    } finally {
      setPending(p => ({ ...p, [user.id]: false }))
    }
  }

  // ── Elimina ──────────────────────────────────────────────────
  async function doDelete(user: UserManagementEntry) {
    setPending(p => ({ ...p, [user.id]: true }))
    try {
      await usersApi.delete(user.id)
      setUsers(list => list.filter(u => u.id !== user.id))
    } catch (err) {
      const code = err instanceof ApiError ? err.code : (err as Error).message ?? 'ERRORE'
      showToast(`Impossibile eliminare l'utente: ${code}`, 'error')
      await loadUsers()
    } finally {
      setPending(p => ({ ...p, [user.id]: false }))
    }
  }

  // ── Rigenera QR ──────────────────────────────────────────────
  async function doRegenQr(user: UserManagementEntry) {
    setPending(p => ({ ...p, [user.id]: true }))
    try {
      const result = await usersApi.regenQr(user.id)
      setQrResult({ qrCodeUrl: result.qrCodeUrl, backupKey: result.backupKey, emailSent: result.emailSent, type: 'regen' })
      await loadUsers()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : (err as Error).message ?? 'ERRORE'
      showToast(`Impossibile rigenerare il QR: ${code}`, 'error')
    } finally {
      setPending(p => ({ ...p, [user.id]: false }))
    }
  }

  // ── UI ────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Gestione Utenti</h2>
          <p className="text-slate-400 text-sm mt-0.5">
            Crea e gestisci gli account con accesso all'applicazione
          </p>
        </div>
        <button
          onClick={() => { setShowNewForm(true); setCreateError(null) }}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                     text-white text-sm font-medium rounded-lg transition"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuovo Utente
        </button>
      </div>

      {/* Errore caricamento */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-950 border border-red-800 text-red-300 text-sm">
          {error}
          <button onClick={loadUsers} className="ml-3 underline text-red-400">Riprova</button>
        </div>
      )}

      {/* Form nuovo utente */}
      {showNewForm && (
        <div className="mb-6 p-5 bg-slate-900 border border-slate-700 rounded-xl">
          <h3 className="text-white font-semibold mb-4">Crea nuovo utente</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Email (sarà l'username)
              </label>
              <input
                ref={emailRef}
                type="email"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="mario.rossi@ateneo.it"
                disabled={creating}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700
                           text-white placeholder-slate-500 text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500
                           disabled:opacity-50 transition"
              />
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="isAdmin"
                checked={form.isAdmin}
                onChange={e => setForm(f => ({ ...f, isAdmin: e.target.checked }))}
                disabled={creating}
                className="w-4 h-4 accent-indigo-600"
              />
              <label htmlFor="isAdmin" className="text-sm text-slate-300">
                Privilegi admin (accesso a questa pagina e creazione utenti)
              </label>
            </div>

            {createError && (
              <p className="text-sm text-red-400">{createError}</p>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={creating || !form.username.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm
                           font-medium rounded-lg transition disabled:opacity-50"
              >
                {creating ? 'Creazione…' : 'Crea utente'}
              </button>
              <button
                type="button"
                onClick={() => setShowNewForm(false)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm
                           font-medium rounded-lg transition"
              >
                Annulla
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tabella utenti */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <svg className="animate-spin w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : users.length === 0 ? (
        <p className="text-slate-500 text-center py-12">Nessun utente trovato.</p>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Email</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Ruolo</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Stato</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Ultimo accesso</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((u, idx) => (
                <tr
                  key={u.id}
                  className={`border-b border-slate-800/60 ${idx % 2 === 0 ? '' : 'bg-slate-900/50'}`}
                >
                  {/* Email */}
                  <td className="px-4 py-3 text-white font-medium">{u.username}</td>

                  {/* Ruolo */}
                  <td className="px-4 py-3">
                    {u.isAdmin
                      ? <span className="px-2 py-0.5 rounded-full bg-indigo-900/60 text-indigo-300 text-xs font-medium">Admin</span>
                      : <span className="px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400 text-xs">Utente</span>
                    }
                  </td>

                  {/* Stato */}
                  <td className="px-4 py-3">
                    {!u.totpVerified
                      ? <span className="px-2 py-0.5 rounded-full bg-amber-900/50 text-amber-400 text-xs">In attesa attivazione</span>
                      : u.isActive
                        ? <span className="px-2 py-0.5 rounded-full bg-emerald-900/50 text-emerald-400 text-xs">Attivo</span>
                        : <span className="px-2 py-0.5 rounded-full bg-red-900/50 text-red-400 text-xs">Disabilitato</span>
                    }
                  </td>

                  {/* Ultimo accesso */}
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {u.lastLoginAt
                      ? new Date(u.lastLoginAt).toLocaleString('it-IT')
                      : '—'
                    }
                  </td>

                  {/* Azioni */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      {/* Toggle ruolo admin — non visibile su se stessi o su "admin" protetto */}
                      {u.id !== currentUser?.id && u.username !== 'admin' && (
                        <button
                          onClick={() => setConfirmAdmin(u)}
                          disabled={!!pending[u.id]}
                          title={u.isAdmin ? 'Rimuovi admin' : 'Promuovi admin'}
                          className={`p-1.5 rounded-lg text-xs transition disabled:opacity-50
                            ${u.isAdmin
                              ? 'text-indigo-400 hover:bg-indigo-900/30'
                              : 'text-slate-500 hover:text-indigo-400 hover:bg-indigo-900/20'
                            }`}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                          </svg>
                        </button>
                      )}

                      {/* Toggle attivo */}
                      <button
                        onClick={() => handleToggleActive(u)}
                        disabled={!!pending[u.id]}
                        title={u.isActive ? 'Disabilita' : 'Abilita'}
                        className={`p-1.5 rounded-lg text-xs transition disabled:opacity-50
                          ${u.isActive
                            ? 'text-amber-400 hover:bg-amber-900/30'
                            : 'text-emerald-400 hover:bg-emerald-900/30'
                          }`}
                      >
                        {u.isActive ? (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        )}
                      </button>

                      {/* Rigenera QR */}
                      <button
                        onClick={() => setConfirmRegen(u)}
                        disabled={!!pending[u.id]}
                        title="Rigenera QR TOTP"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white
                                   hover:bg-slate-700 transition disabled:opacity-50"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>

                      {/* Elimina */}
                      <button
                        onClick={() => setConfirmDelete(u)}
                        disabled={!!pending[u.id]}
                        title="Elimina utente"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400
                                   hover:bg-red-950/30 transition disabled:opacity-50"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal QR code */}
      <ConfirmDialog
        open={!!confirmAdmin}
        title={confirmAdmin?.isAdmin ? 'Rimuovi privilegi admin' : 'Promuovi admin'}
        message={confirmAdmin
          ? `${confirmAdmin.isAdmin ? 'Rimuovere i privilegi admin da' : 'Promuovere admin'} "${confirmAdmin.username}"?`
          : ''}
        danger={confirmAdmin?.isAdmin}
        onConfirm={() => { if (confirmAdmin) doToggleAdmin(confirmAdmin); setConfirmAdmin(null) }}
        onCancel={() => setConfirmAdmin(null)}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title="Elimina utente"
        message={confirmDelete ? `Eliminare definitivamente "${confirmDelete.username}"?` : ''}
        danger
        confirmLabel="Elimina"
        onConfirm={() => { if (confirmDelete) doDelete(confirmDelete); setConfirmDelete(null) }}
        onCancel={() => setConfirmDelete(null)}
      />
      <ConfirmDialog
        open={!!confirmRegen}
        title="Rigenera QR TOTP"
        message={confirmRegen ? `Rigenerare il QR TOTP per "${confirmRegen.username}"? L'utente dovrà riattivare l'account.` : ''}
        danger
        onConfirm={() => { if (confirmRegen) doRegenQr(confirmRegen); setConfirmRegen(null) }}
        onCancel={() => setConfirmRegen(null)}
      />

      {qrResult && (
        <QrModal
          result={qrResult}
          onClose={() => setQrResult(null)}
        />
      )}
    </div>
  )
}

// ── Modal QR ─────────────────────────────────────────────────

interface QrModalProps {
  result: {
    qrCodeUrl: string
    backupKey: string
    emailSent: boolean
    type:      'create' | 'regen'
  }
  onClose: () => void
}

function QrModal({ result, onClose }: QrModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl
                      shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h3 className="text-white font-semibold">
            {result.type === 'create' ? 'Account creato' : 'QR rigenerato'}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {result.emailSent ? (
            <div className="flex items-center gap-2.5 p-3 rounded-lg bg-emerald-950 border border-emerald-800">
              <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <p className="text-emerald-300 text-sm">
                Email con QR code inviata all'utente.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 p-3 rounded-lg bg-amber-950/60 border border-amber-800/60">
              <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-amber-300 text-sm">
                SMTP non configurato — consegna manuale del QR necessaria.
              </p>
            </div>
          )}

          <p className="text-slate-400 text-sm">
            Mostra questo QR all'utente per configurare Google Authenticator.
            <strong className="text-white"> Verrà mostrato una sola volta.</strong>
          </p>

          {/* QR */}
          <div className="flex justify-center bg-white rounded-xl p-4">
            <img src={result.qrCodeUrl} alt="QR Code TOTP" className="w-48 h-48" />
          </div>

          {/* Chiave di backup */}
          <div className="p-3 rounded-lg bg-slate-800 border border-slate-700">
            <p className="text-amber-400 text-xs font-semibold mb-1.5">⚠ Chiave di backup</p>
            <p className="font-mono text-amber-300 text-sm tracking-widest break-all">
              {result.backupKey}
            </p>
            <p className="text-slate-500 text-xs mt-1.5">
              Conservarla in un luogo sicuro — serve se l'utente perde il telefono.
            </p>
          </div>

          <button
            onClick={onClose}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white
                       font-medium text-sm rounded-lg transition"
          >
            Ho salvato il QR — Chiudi
          </button>
        </div>
      </div>
    </div>
  )
}
