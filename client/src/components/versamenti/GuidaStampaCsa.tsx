// ============================================================
// PAYROLL GANG SUITE — Versamenti enti · come estrarre la stampa da CSA
//
// Ricostruzione SCHEMATICA della finestra «Stampa versamenti» di CSA, con
// evidenziate le opzioni da usare. Non e' una schermata: le schermate di
// CSA non vanno nel repository pubblico.
// ============================================================

import type { ReactNode } from 'react'

function Casella({ on, nota, children }: { on: boolean; nota?: boolean; children: ReactNode }) {
  return (
    <div className={`flex items-center gap-2 px-1.5 py-0.5 rounded ${nota ? 'ring-2 ring-amber-500/80 bg-amber-500/10' : ''}`}>
      <span className={`w-3.5 h-3.5 shrink-0 rounded-sm border flex items-center justify-center text-[10px] leading-none
        ${on ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-600'}`}>{on ? '✓' : ''}</span>
      <span className={on ? 'text-slate-100' : 'text-slate-500'}>{children}</span>
    </div>
  )
}

function Campo({ etichetta, valore, nota }: { etichetta: string; valore: string; nota?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-400 w-10 text-right">{etichetta}</span>
      <span className={`px-2 py-0.5 rounded border border-slate-600 bg-slate-950 text-slate-100 min-w-[96px] ${nota ? 'ring-2 ring-amber-500/80' : ''}`}>{valore}</span>
    </div>
  )
}

export default function GuidaStampaCsa() {
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start">
      <figure className="border border-slate-700 rounded-lg overflow-hidden text-xs" aria-label="Schema della finestra Stampa versamenti di CSA">
        <div className="bg-slate-800 px-3 py-1.5 text-slate-200 font-medium">Stampa versamenti <span className="text-slate-500 font-normal">— schema, non è una schermata</span></div>
        <div className="p-3 flex flex-col gap-3 bg-slate-900">
          <div className="flex flex-wrap gap-4 justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-slate-500 uppercase tracking-wider text-[10px]">Stampa</span>
              <Casella on>di controllo (anche liq.)</Casella>
              <Casella on={false}>definitiva (solo accrediti)</Casella>
            </div>
            <div className="flex flex-col gap-1.5">
              <Campo etichetta="Anno" valore="2025" />
              <Campo etichetta="da" valore="Gennaio" nota />
              <Campo etichetta="a" valore="Dicembre" nota />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-slate-500 uppercase tracking-wider text-[10px]">Opzioni</span>
            <Casella on nota>Dettaglio nominativo</Casella>
            <Casella on nota>Dettaglio codice fiscale</Casella>
            <Casella on nota>Dettaglio aliquota/parti/imp.</Casella>
            <Casella on nota>Suddivisione per mese <span className="text-amber-300">(facoltativa)</span></Casella>
            <Casella on={false}>altre suddivisioni: lasciale spente</Casella>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-slate-500 uppercase tracking-wider text-[10px]">Ordinamento</span>
            <Casella on>Ente/voce</Casella>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-slate-500 uppercase tracking-wider text-[10px]">Scelta liquidato</span>
            <div className="flex flex-wrap gap-2">
              <span className="px-2.5 py-1 rounded border border-slate-600 bg-slate-800 text-slate-100 ring-2 ring-amber-500/80">Ruoli…</span>
              <span className="px-2.5 py-1 rounded border border-slate-600 bg-slate-800 text-slate-100 ring-2 ring-amber-500/80">Accrediti/liquidazioni…</span>
              <span className="px-2.5 py-1 rounded border border-slate-700 bg-slate-800 text-slate-400">Matricole… (tutte)</span>
            </div>
          </div>
        </div>
      </figure>
      <ol className="list-decimal ml-5 space-y-1.5 text-xs text-slate-400">
        <li>In CSA apri <b className="text-slate-200">Stampa versamenti</b>, scheda <i>Parametri</i>, stampa <i>di controllo</i>.</li>
        <li>Indica <b className="text-slate-200">Anno</b> e i mesi <b className="text-slate-200">da / a</b>.</li>
        <li>Spunta <b className="text-slate-200">Dettaglio nominativo</b>, <b className="text-slate-200">Dettaglio codice fiscale</b> e <b className="text-slate-200">Dettaglio aliquota/parti/imp.</b>: servono nominativo, codice fiscale, data di nascita e importo di ogni riga.</li>
        <li><b className="text-slate-200">Suddivisione per mese</b> è facoltativa. Con la spunta il file ha la colonna <span className="font-mono">MESE</span> e PGS separa i mesi (un EML per mese, subtotali); senza, ogni importo è la somma del periodo <i>da … a …</i>, che PGS legge dal nome del file.</li>
        <li>Scegli <b className="text-slate-200">Ruoli</b> e <b className="text-slate-200">Accrediti/liquidazioni</b>; matricole: tutte. Ordinamento <i>Ente/voce</i>.</li>
        <li>Esporta in CSV e lascia il nome proposto (es. <span className="font-mono">STAMPA_VERSAMENTI_20260706_GEN_DIC_2025.CSV</span>): da lì PGS ricava anno e periodo.</li>
      </ol>
    </div>
  )
}
