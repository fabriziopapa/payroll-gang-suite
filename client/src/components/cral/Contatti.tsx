// ============================================================
// PAYROLL GANG SUITE — Modulo CRAL · telefono, consensi, esigenze alimentari
// Campi della scheda persona, segni nell'elenco, modifiche in blocco.
// Il numero si scrive come si vuole: si conserva in E.164 (+39…), il
// formato delle API di WhatsApp. Le regole sono in contatti.ts (le stesse
// del server).
// ============================================================

import { useState } from 'react'
import { cralApi, type CralPatchAlimentari, type CralPatchContatti } from '../../api/endpoints'
import type { Persona } from './tipi'
import {
  ESIGENZE, ORIGINI, contattabile, leggiTelefono, mostraTelefono, nomiEsigenze, perWhatsapp,
  type Consenso, type Esigenza, type Origine, type StatoWa,
} from './contatti'
import { fmtData, nominativo, oggi } from './logica'
import { Campo, D, Ico, Interruttore, Modale, Pill, btnPrimario, btnSecondario, chipCls, etichettaCls, inputCls, useCral } from './ui'

export interface FormContatti { telefono: string; consenso: Consenso; consensoIl: string; origine: Origine | ''; whatsapp: StatoWa }
export interface FormAlimentari { consenso: boolean; esigenze: Esigenza[]; allergie: string }
export const FORM_CONTATTI_VUOTO: FormContatti = { telefono: '', consenso: 'NO', consensoIl: '', origine: '', whatsapp: 'NV' }
export const FORM_ALIMENTARI_VUOTO: FormAlimentari = { consenso: false, esigenze: [], allergie: '' }
export const formContatti = (s: Persona): FormContatti => ({
  telefono: mostraTelefono(s.contatti.telefono), consenso: s.contatti.consenso, consensoIl: s.contatti.consensoIl ?? '', origine: s.contatti.origine ?? '', whatsapp: s.contatti.whatsapp,
})
export const formAlimentari = (s: Persona): FormAlimentari => ({ consenso: s.alimentari.consenso, esigenze: [...s.alimentari.esigenze], allergie: s.alimentari.allergie })

/** Dal modulo a quello che va al server: solo ciò che cambia. `s` null = persona nuova. */
export function patchContatti(fc: FormContatti, fa: FormAlimentari, s: Persona | null, prefisso: string):
  { contatti?: CralPatchContatti; alimentari?: CralPatchAlimentari } | { errore: string } {
  const t = leggiTelefono(fc.telefono, prefisso)
  if (t && 'errore' in t) return { errore: `Telefono: ${t.errore}.` }
  const numero = t?.e164 ?? ''
  const prima = s?.contatti
  const cambiato = numero !== (prima?.telefono ?? '')
  const base = cambiato || !prima ? { consenso: 'NO' as Consenso, consensoIl: null, origine: null, whatsapp: 'NV' as StatoWa } : prima
  const c: CralPatchContatti = {}
  if (cambiato) c.telefono = numero
  if (numero) {
    if (fc.consenso === 'SI') {
      if (!fc.origine) return { errore: 'Indica come è stato raccolto il consenso all\'uso del numero.' }
      if (fc.consensoIl && fc.consensoIl > oggi()) return { errore: 'La data del consenso è nel futuro.' }
      if (base.consenso !== 'SI' || (fc.consensoIl || null) !== base.consensoIl || fc.origine !== base.origine) {
        c.consenso = 'SI'; c.origine = fc.origine
        if (fc.consensoIl) c.consensoIl = fc.consensoIl
      }
    } else if (fc.consenso !== base.consenso) c.consenso = fc.consenso
    if (fc.whatsapp !== base.whatsapp) c.whatsapp = fc.whatsapp
  }
  const a0 = s ? formAlimentari(s) : FORM_ALIMENTARI_VUOTO
  const allergie = fa.consenso ? fa.allergie.trim() : ''
  const a1: FormAlimentari = { consenso: fa.consenso, esigenze: fa.consenso ? ESIGENZE.map(e => e.id).filter(e => fa.esigenze.includes(e)) : [], allergie }
  const out: { contatti?: CralPatchContatti; alimentari?: CralPatchAlimentari } = {}
  if (Object.keys(c).length) out.contatti = c
  if (JSON.stringify(a0) !== JSON.stringify(a1)) out.alimentari = a1
  return out
}

/** Campi di telefono, consenso e WhatsApp + esigenze alimentari, dentro la scheda. */
export function CampiContatti({ s, fc, fa, onC, onA }: {
  s: Persona | null; fc: FormContatti; fa: FormAlimentari; onC: (f: FormContatti) => void; onA: (f: FormAlimentari) => void
}) {
  const { db } = useCral()
  const t = leggiTelefono(fc.telefono, db.prefissoTel)
  const numero = t && 'e164' in t ? t.e164 : ''
  const prima = s?.contatti
  const cambiato = numero !== (prima?.telefono ?? '')
  const stesso = numero ? db.soci.filter(x => x.id !== s?.id && x.contatti.telefono === numero && x.stato !== 'ELIMINATO') : []
  function scrivi(v: string) {
    const n = leggiTelefono(v, db.prefissoTel)
    const nuovo = n && 'e164' in n ? n.e164 : ''
    // numero diverso da quello salvato: il consenso va chiesto di nuovo
    if (nuovo !== (prima?.telefono ?? '') && nuovo !== numero) onC({ ...FORM_CONTATTI_VUOTO, telefono: v })
    else if (nuovo === (prima?.telefono ?? '') && s && cambiato) onC({ ...formContatti(s), telefono: v })
    else onC({ ...fc, telefono: v })
  }
  const revocato = !cambiato && prima?.consenso === 'REVOCATO'
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-slate-800 p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2"><span className={etichettaCls + ' flex-1'}>Telefono e WhatsApp</span>
          {s && perWhatsapp(s.contatti) && !cambiato && <a className="text-xs text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1" href={`https://wa.me/${s.contatti.waId}`} target="_blank" rel="noopener noreferrer"><Ico d={D.link} cls="w-3.5 h-3.5" />Apri la chat WhatsApp</a>}</div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Campo label="Numero di telefono" hint={
            t && 'errore' in t ? <span className="text-red-400">{t.errore}</span>
              : t ? <>Si salva come <span className="font-mono text-slate-300">{t.e164}</span>{t.avviso ? <span className="text-amber-400"> · {t.avviso}</span> : ''}{stesso.length > 0 && <span className="text-amber-400"> · stesso numero di {stesso.slice(0, 3).map(nominativo).join(', ')}{stesso.length > 3 ? '…' : ''}</span>}</>
                : `Scrivilo come vuoi: senza prefisso prende +${db.prefissoTel}`}>
            <input className={inputCls} inputMode="tel" autoComplete="off" placeholder="333 123 4567" value={fc.telefono} onChange={e => scrivi(e.target.value)} /></Campo>
          <Campo label="Su WhatsApp" hint={!cambiato && prima?.waIl ? `Verificato il ${fmtData(prima.waIl)}${prima.waFonte === 'FILE' ? ' (da file)' : ''}` : numero ? undefined : 'Serve il numero'}>
            <select className={inputCls} disabled={!numero} value={fc.whatsapp} onChange={e => onC({ ...fc, whatsapp: e.target.value as StatoWa })}>
              <option value="NV">Non verificato</option><option value="SI">Sì</option><option value="NO">No</option></select></Campo>
          <Campo label="Consenso all'uso del numero (GDPR)" hint={
            revocato ? <span className="text-amber-400">Revocato il {fmtData(prima?.revocatoIl ?? null)}{prima?.consensoIl ? ` (era stato dato il ${fmtData(prima.consensoIl)})` : ''}: per rimetterlo serve un nuovo consenso.</span>
              : cambiato && prima?.telefono && numero ? <span className="text-amber-400">Numero nuovo: il consenso va chiesto di nuovo.</span>
                : fc.consenso !== 'SI' && numero ? 'Senza consenso il numero resta in scheda ma non entra nelle liste di contatto.' : undefined}>
            <select className={inputCls} disabled={!numero} value={fc.consenso} onChange={e => { const v = e.target.value as Consenso; onC({ ...fc, consenso: v, ...(v === 'SI' && (cambiato || prima?.consenso !== 'SI') ? { consensoIl: oggi(), origine: '' as const } : {}) }) }}>
              {!revocato && <option value="NO">No</option>}
              <option value="SI">{revocato ? 'Sì — nuovo consenso' : 'Sì'}</option>
              {(revocato || (!cambiato && prima?.consenso === 'SI')) && <option value="REVOCATO">Revocato</option>}</select></Campo>
          {fc.consenso === 'SI' && numero ? <div className="grid grid-cols-2 gap-3">
            <Campo label="Dato il"><input type="date" className={inputCls} max={oggi()} value={fc.consensoIl} onChange={e => onC({ ...fc, consensoIl: e.target.value })} /></Campo>
            <Campo label="Raccolto con"><select className={inputCls} value={fc.origine} onChange={e => onC({ ...fc, origine: e.target.value as Origine | '' })}><option value="">— Scegli</option>{ORIGINI.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}</select></Campo>
          </div> : <div />}
        </div>
      </div>
      <div className="rounded-lg border border-slate-800 p-4 flex flex-col gap-3">
        <span className={etichettaCls}>Esigenze alimentari</span>
        <Interruttore on={fa.consenso} onChange={v => onA(v ? { ...fa, consenso: true } : { ...FORM_ALIMENTARI_VUOTO })} label="Consenso al trattamento dei dati alimentari (dati relativi alla salute)" />
        {fa.consenso ? <>
          <div className="flex flex-wrap gap-1.5">{ESIGENZE.map(e => { const on = fa.esigenze.includes(e.id); return <button key={e.id} type="button" aria-pressed={on} className={chipCls(on)} onClick={() => onA({ ...fa, esigenze: on ? fa.esigenze.filter(x => x !== e.id) : [...fa.esigenze, e.id] })}>{e.nome}</button> })}</div>
          <Campo label="Allergie" hint={s?.alimentari.consensoIl ? `Consenso dato il ${fmtData(s.alimentari.consensoIl)}` : 'Testo libero: es. arachidi, crostacei'}><input className={inputCls} maxLength={300} value={fa.allergie} onChange={e => onA({ ...fa, allergie: e.target.value })} /></Campo>
        </> : <p className="text-xs text-slate-500">{s?.alimentari.consenso ? <span className="text-amber-400">Salvando senza consenso, esigenze e allergie vengono cancellate.</span> : 'Senza consenso esigenze e allergie non si conservano.'}</p>}
      </div>
    </div>
  )
}

const SIGLE: Record<Esigenza, string> = { VEGETARIANO: 'vegetar.', VEGANO: 'vegano', CELIACO: 'no glutine', LATTOSIO: 'no lattosio' }
/** I segni nell'elenco: telefono (col consenso o senza), WhatsApp, esigenze alimentari. */
export function SegniContatti({ s }: { s: Persona }) {
  const c = s.contatti, a = s.alimentari
  const alim = [...a.esigenze.map(e => SIGLE[e]), ...(a.allergie ? ['allergie'] : [])]
  if (!c.telefono && !alim.length) return <span className="text-slate-600">—</span>
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {c.telefono && (perWhatsapp(c) && c.whatsapp === 'SI' ? <Pill tono="ok" title={`${mostraTelefono(c.telefono)} · WhatsApp · consenso dal ${fmtData(c.consensoIl)}`}>WhatsApp</Pill>
        : contattabile(c) ? <Pill tono="ok" title={`${mostraTelefono(c.telefono)} · consenso dal ${fmtData(c.consensoIl)} · WhatsApp ${c.whatsapp === 'NO' ? 'no' : 'non verificato'}`}>tel.</Pill>
          : c.consenso === 'REVOCATO' ? <Pill tono="err" title={`Consenso revocato il ${fmtData(c.revocatoIl)}: il numero non entra nelle liste di contatto`}>tel. revocato</Pill>
            : <Pill title="Numero senza consenso: non entra nelle liste di contatto">tel. senza consenso</Pill>)}
      {alim.length > 0 && <Pill tono="warn" title={[nomiEsigenze(a.esigenze), a.allergie ? `allergie: ${a.allergie}` : ''].filter(Boolean).join(' · ')}>{alim.join(' · ')}</Pill>}
    </span>
  )
}

/** Consenso, WhatsApp e consenso ai dati alimentari su più persone insieme. Il numero no: è di ciascuno. */
export function ContattiInBlocco({ ids, onClose, onFatto }: { ids: string[]; onClose: () => void; onFatto: () => void }) {
  const { db, esegui } = useCral()
  const [cons, setCons] = useState<'' | 'SI' | 'REVOCATO'>('')
  const [il, setIl] = useState(oggi())
  const [origine, setOrigine] = useState<Origine | ''>('')
  const [wa, setWa] = useState<'' | StatoWa>('')
  const [alim, setAlim] = useState<'' | 'SI' | 'NO'>('')
  const pers = ids.flatMap(id => { const p = db.perId.get(id); return p ? [p] : [] })
  const conNumero = pers.filter(p => p.contatti.telefono).length
  const conDati = pers.filter(p => p.alimentari.consenso && (p.alimentari.esigenze.length || p.alimentari.allergie)).length
  const pronto = (!!cons || !!wa || !!alim) && (cons !== 'SI' || (!!origine && !!il && il <= oggi()))
  async function applica() {
    const contatti = { ...(cons === 'SI' ? { consenso: 'SI' as const, consensoIl: il, origine: origine as Origine } : cons === 'REVOCATO' ? { consenso: 'REVOCATO' as const } : {}), ...(wa ? { whatsapp: wa } : {}) }
    const r = await esegui(() => cralApi.contattiInBlocco(ids, { ...(Object.keys(contatti).length ? { contatti } : {}), ...(alim ? { alimentari: { consenso: alim === 'SI' } } : {}) }),
      x => `Aggiornate ${x.fatte} persone${x.saltate ? ` · ${x.saltate} saltate (senza numero)` : ''}`)
    if (r) { onFatto(); onClose() }
  }
  return (
    <Modale titolo="Consensi e WhatsApp in blocco" sotto={`${ids.length} persone selezionate · ${conNumero} con un numero di telefono`} onClose={onClose} piedi={<>
      <button className={btnSecondario} onClick={onClose}>Annulla</button><button className={btnPrimario} disabled={!pronto} onClick={() => void applica()}>Applica</button></>}>
      <div className="flex flex-col gap-4">
        <Campo label="Consenso all'uso del numero" hint="Vale solo per chi ha un numero: gli altri si saltano.">
          <select className={inputCls} value={cons} onChange={e => setCons(e.target.value as typeof cons)}><option value="">Non cambiare</option><option value="SI">Sì — consenso dato</option><option value="REVOCATO">Revocato</option></select></Campo>
        {cons === 'SI' && <div className="grid grid-cols-2 gap-3">
          <Campo label="Dato il"><input type="date" className={inputCls} max={oggi()} value={il} onChange={e => setIl(e.target.value)} /></Campo>
          <Campo label="Raccolto con"><select className={inputCls} value={origine} onChange={e => setOrigine(e.target.value as Origine | '')}><option value="">— Scegli</option>{ORIGINI.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}</select></Campo></div>}
        <Campo label="Su WhatsApp"><select className={inputCls} value={wa} onChange={e => setWa(e.target.value as typeof wa)}><option value="">Non cambiare</option><option value="SI">Sì</option><option value="NO">No</option><option value="NV">Non verificato</option></select></Campo>
        <Campo label="Consenso ai dati alimentari" hint={alim === 'NO' && conDati ? <span className="text-amber-400">{conDati} persone hanno esigenze o allergie registrate: verranno cancellate.</span> : 'Le esigenze si indicano poi nella scheda di ciascuno o con il tracciato T6.'}>
          <select className={inputCls} value={alim} onChange={e => setAlim(e.target.value as typeof alim)}><option value="">Non cambiare</option><option value="SI">Sì — consenso dato oggi</option><option value="NO">No — cancella esigenze e allergie</option></select></Campo>
      </div>
    </Modale>
  )
}
