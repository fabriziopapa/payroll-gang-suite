// ============================================================
// PAYROLL GANG SUITE — Pagina Verifica liquidato (CINECA)
// Admin: anno/mese/matricola → dettaglio liquidato + ricostruzione invii PGS.
// Ogni lettura è auditata lato server (dato sensibile).
// ============================================================

import { useState } from 'react'
import {
  verificaLiquidatoApi,
  type LiquidatoDettaglioApi, type RigaRicostruitaApi,
} from '../api/endpoints'
import { showToast } from '../components/ToastManager'
import { ApiError } from '../api/client'

const eur = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function VerificaLiquidatoPage() {
  const [anno, setAnno] = useState(String(new Date().getFullYear()))
  const [mese, setMese] = useState(String(new Date().getMonth() + 1).padStart(2, '0'))
  const [matricola, setMatricola] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<LiquidatoDettaglioApi | null>(null)

  async function handleCerca() {
    if (!/^\d{4}$/.test(anno) || !/^\d{2}$/.test(mese) || !matricola.trim()) {
      showToast('Compila anno (AAAA), mese (MM) e matricola', 'error'); return
    }
    setLoading(true); setData(null)
    try {
      const res = await verificaLiquidatoApi.dettaglio(anno, mese, matricola.trim())
      setData(res)
      if (res.dettaglio.length === 0) showToast('Nessuna riga nel liquidato per il periodo', 'info')
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'ERRORE'
      showToast(`Lettura fallita: ${code}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const ric = data?.ricostruzione
  const gruppi: Array<{ titolo: string; righe: RigaRicostruitaApi[] }> = ric ? [
    { titolo: 'Invii PGS (nuovi)', righe: ric.inviiPGS },
    { titolo: 'Conguagli tariffa', righe: ric.conguagli },
    { titolo: 'Storni',            righe: ric.storni },
    { titolo: 'Rettifiche',        righe: ric.rettifiche },
  ] : []

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Verifica liquidato</h1>
        <p className="text-sm text-slate-500">Confronta il liquidato CINECA con gli invii ricostruiti di PGS. Solo admin, ogni lettura è auditata.</p>
      </div>

      {/* Form ricerca */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
          <label className="block">
            <span className="text-xs text-slate-500">Anno (AAAA)</span>
            <input className="input mt-1" value={anno} onChange={e => setAnno(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Mese (MM)</span>
            <input className="input mt-1" value={mese} onChange={e => setMese(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Matricola</span>
            <input className="input mt-1" value={matricola} onChange={e => setMatricola(e.target.value)} />
          </label>
          <button
            onClick={handleCerca}
            disabled={loading}
            className="h-[38px] px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Lettura…' : 'Verifica'}
          </button>
        </div>
      </div>

      {/* Esito */}
      {data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Righe liquidato" value={String(data.dettaglio.length)} />
            <Stat label="Invii PGS"       value={String(ric?.inviiPGS.length ?? 0)} />
            <Stat label="Conguagli"       value={String(ric?.conguagli.length ?? 0)} />
            <Stat label="Storni/Rettifiche" value={String((ric?.storni.length ?? 0) + (ric?.rettifiche.length ?? 0))} />
          </div>

          {gruppi.map(g => g.righe.length > 0 && (
            <div key={g.titolo} className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
              <p className="text-sm text-slate-300 font-medium px-4 py-2 border-b border-slate-800">{g.titolo} · {g.righe.length}</p>
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-xs border-b border-slate-800">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Voce</th>
                    <th className="text-left font-medium px-4 py-2">Capitolo</th>
                    <th className="text-left font-medium px-4 py-2">Competenza</th>
                    <th className="text-left font-medium px-4 py-2">Riferimento</th>
                    <th className="text-left font-medium px-4 py-2">Modalità</th>
                    <th className="text-right font-medium px-4 py-2">Valore</th>
                  </tr>
                </thead>
                <tbody>
                  {g.righe.map((r, i) => (
                    <tr key={r.chiave + i} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                      <td className="px-4 py-2 font-mono text-indigo-300">{r.voce}</td>
                      <td className="px-4 py-2 text-slate-400 font-mono">{r.capitolo}</td>
                      <td className="px-4 py-2 text-slate-400">{r.dataCompVoce}</td>
                      <td className="px-4 py-2 text-slate-400 truncate max-w-[16rem]" title={r.riferimento ?? ''}>{r.riferimento ?? '—'}</td>
                      <td className="px-4 py-2 text-slate-400">
                        {r.modalita === 'parti'
                          ? `${r.parti ?? '—'} × ${eur(r.importoUnitario)}`
                          : 'importo'}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-200">
                        {eur(r.importoTotale ?? r.valoreNetto ?? r.valore)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-200">{value}</p>
    </div>
  )
}
