// ============================================================
// PAYROLL GANG SUITE — Layout principale (sidebar + topbar)
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useStore, type PageId } from '../store/useStore'
import { authApi } from '../api/endpoints'
import { APP_NAME, APP_VERSION } from '../types'
import PrivacyCookieModal from './PrivacyCookieModal'
import ToastManager from './ToastManager'
import EasterEggCredits from './easter-egg/EasterEggCredits'

// ── Easter Egg: sequenza tastiera "ALESSIO" ───────────────────
const EE_SEQUENCE = ['a', 'l', 'e', 's', 's', 'i', 'o']
const EE_TIMEOUT  = 3000  // ms — reset sequenza dopo inattività
// ── Easter Egg: long press su badge versione (3 secondi) ──────
const EE_HOLD_MS  = 3000

interface NavItem {
  id:    PageId
  label: string
  icon:  React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  {
    id:    'dashboard',
    label: 'Dashboard',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    id:    'anagrafiche',
    label: 'Anagrafiche',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    id:    'voci',
    label: 'Voci HR',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    id:    'capitoli',
    label: 'Capitoli',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 6h16M4 10h16M4 14h10M4 18h6" />
      </svg>
    ),
  },
  {
    id:    'ricerca',
    label: 'Ricerca',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    id:    'impostazioni',
    label: 'Impostazioni',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    id:    'utenti',
    label: 'Utenti',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
]

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { currentPage, navigate, user, clearAuth, isDirty, currentBozzaNome, viewerBozza } = useStore()

  // Nav items dinamici: "Utenti" visibile solo agli admin
  const visibleNavItems = NAV_ITEMS.filter(item =>
    item.id !== 'utenti' || user?.isAdmin,
  )
  const [loggingOut, setLoggingOut]   = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [showEasterEgg, setShowEasterEgg] = useState(false)

  // ── Easter Egg: sequenza tastiera ─────────────────────────
  const eeSeqRef      = useRef<string[]>([])
  const eeSeqTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ignora se si sta scrivendo in un input
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const key = e.key.toLowerCase()
      eeSeqRef.current.push(key)

      // Reset timeout
      if (eeSeqTimer.current) clearTimeout(eeSeqTimer.current)
      eeSeqTimer.current = setTimeout(() => { eeSeqRef.current = [] }, EE_TIMEOUT)

      // Controlla se la coda termina con la sequenza
      const seq  = eeSeqRef.current
      const tail = seq.slice(-EE_SEQUENCE.length)
      if (tail.length === EE_SEQUENCE.length && tail.every((c, i) => c === EE_SEQUENCE[i])) {
        eeSeqRef.current = []
        setShowEasterEgg(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── Easter Egg: long press badge versione ─────────────────
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdStart = useRef<number>(0)

  const onVersionPointerDown = useCallback(() => {
    holdStart.current = Date.now()
    holdTimer.current = setTimeout(() => setShowEasterEgg(true), EE_HOLD_MS)
  }, [])

  const onVersionPointerUp = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
  }, [])

  async function handleLogout() {
    setLoggingOut(true)
    try { await authApi.logout() } catch (e) { console.warn('logout server failed', e) }
    clearAuth()
  }

  const isEditor = currentPage === 'editor'
  const isViewer = currentPage === 'viewer'

  return (
    <div className="h-screen bg-slate-950 flex overflow-hidden">

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-60 bg-slate-900 border-r border-slate-800
        flex flex-col transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:inset-auto
      `}>
        {/* Brand */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{APP_NAME}</p>
            <p
              className="text-xs text-slate-500 cursor-default select-none"
              onPointerDown={onVersionPointerDown}
              onPointerUp={onVersionPointerUp}
              onPointerLeave={onVersionPointerUp}
              title=""
            >v{APP_VERSION}</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {visibleNavItems.map(item => (
            <button
              key={item.id}
              onClick={() => { navigate(item.id); setSidebarOpen(false) }}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                transition-colors text-left
                ${currentPage === item.id || ((isEditor || isViewer) && item.id === 'dashboard')
                  ? 'bg-indigo-600/20 text-indigo-400'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'}
              `}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {/* User + logout */}
        <div className="px-3 py-4 border-t border-slate-800">
          <div className="flex items-center gap-3 px-3 py-2 mb-1">
            <div className="w-7 h-7 rounded-full bg-indigo-700 flex items-center justify-center text-xs font-bold text-white">
              {user?.username?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">{user?.username}</p>
              {user?.isAdmin && <p className="text-xs text-indigo-400">Admin</p>}
            </div>
          </div>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                       text-slate-400 hover:text-red-400 hover:bg-red-950/30
                       transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {loggingOut ? 'Uscita…' : 'Esci'}
          </button>

          <button
            onClick={() => setShowPrivacy(true)}
            className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs
                       text-slate-600 hover:text-slate-400 hover:bg-slate-800/50
                       transition-colors mt-0.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Privacy & Cookie
          </button>
        </div>

      </aside>

      {/* Overlay mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Main ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Topbar */}
        <header className="sticky top-0 z-20 h-14 bg-slate-900/80 backdrop-blur
                           border-b border-slate-800 flex items-center px-4 gap-3">
          {/* Hamburger mobile */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Breadcrumb / titolo pagina */}
          <div className="flex-1 min-w-0">
            {isEditor ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate('dashboard')}
                  className="text-slate-400 hover:text-white text-sm transition"
                >
                  Dashboard
                </button>
                <span className="text-slate-600">/</span>
                <span className="text-white text-sm font-medium truncate">{currentBozzaNome || 'Nuova liquidazione'}</span>
                {isDirty && (
                  <span className="text-xs bg-amber-900/50 text-amber-400 border border-amber-800
                                   px-1.5 py-0.5 rounded-full shrink-0">
                    Non salvato
                  </span>
                )}
              </div>
            ) : isViewer ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate('dashboard')}
                  className="text-slate-400 hover:text-white text-sm transition"
                >
                  Dashboard
                </button>
                <span className="text-slate-600">/</span>
                <span className="text-white text-sm font-medium truncate">{viewerBozza?.nome || 'Liquidazione'}</span>
                <span className="text-xs bg-slate-800 text-slate-400 border border-slate-700
                                 px-1.5 py-0.5 rounded-full shrink-0">
                  Sola lettura
                </span>
              </div>
            ) : (
              <h1 className="text-white font-semibold text-sm">
                {NAV_ITEMS.find(n => n.id === currentPage)?.label ?? currentPage}
              </h1>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
      {showPrivacy && <PrivacyCookieModal onClose={() => setShowPrivacy(false)} />}
      <ToastManager />
      {showEasterEgg && (
        <EasterEggCredits onClose={() => setShowEasterEgg(false)} />
      )}
    </div>
  )
}
