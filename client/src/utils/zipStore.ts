// ============================================================
// PAYROLL GANG SUITE — ZIP senza compressione ("stored")
//
// Per scaricare in un colpo solo un file per ente (Consultazione dei
// versamenti). Nessuna dipendenza: PDF e CSV sono gia' piccoli o gia'
// compressi, e un formato "stored" e' poche righe da verificare.
// Nomi solo ASCII (li produce nomeFile, che toglie il resto), niente
// percorsi: ogni voce e' un file nella radice dello ZIP.
// ============================================================

const TABELLA = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(b: Uint8Array): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < b.length; i++) c = TABELLA[(c ^ b[i]!) & 0xFF]! ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

export interface VoceZip { nome: string; bytes: Uint8Array<ArrayBuffer> }

/** Data e ora DOS (risoluzione 2 secondi), ora locale. */
function dataDos(d: Date): { ora: number; giorno: number } {
  return {
    ora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    giorno: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

export function zipStore(voci: readonly VoceZip[], quando = new Date()): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const { ora, giorno } = dataDos(quando)
  const visti = new Set<string>()
  const locali: Uint8Array[] = [], centrali: Uint8Array[] = []
  let offset = 0
  for (const v of voci) {
    // niente cartelle o percorsi relativi, niente nomi doppi
    const base = v.nome.replace(/[\\/]+/g, '_').replace(/^\.+/, '_') || 'file'
    let nome = base
    for (let i = 2; visti.has(nome); i++) nome = base.replace(/(\.[^.]*)?$/, m => `_${i}${m}`)
    visti.add(nome)
    const n = enc.encode(nome), crc = crc32(v.bytes), size = v.bytes.length
    const loc = new Uint8Array(30 + n.length), dl = new DataView(loc.buffer)
    dl.setUint32(0, 0x04034b50, true); dl.setUint16(4, 20, true); dl.setUint16(6, 0, true); dl.setUint16(8, 0, true)
    dl.setUint16(10, ora, true); dl.setUint16(12, giorno, true); dl.setUint32(14, crc, true)
    dl.setUint32(18, size, true); dl.setUint32(22, size, true); dl.setUint16(26, n.length, true); dl.setUint16(28, 0, true)
    loc.set(n, 30)
    const cen = new Uint8Array(46 + n.length), dc = new DataView(cen.buffer)
    dc.setUint32(0, 0x02014b50, true); dc.setUint16(4, 20, true); dc.setUint16(6, 20, true); dc.setUint16(8, 0, true)
    dc.setUint16(10, 0, true); dc.setUint16(12, ora, true); dc.setUint16(14, giorno, true); dc.setUint32(16, crc, true)
    dc.setUint32(20, size, true); dc.setUint32(24, size, true); dc.setUint16(28, n.length, true)
    dc.setUint32(42, offset, true)
    cen.set(n, 46)
    locali.push(loc, v.bytes); centrali.push(cen)
    offset += loc.length + size
  }
  const dimCen = centrali.reduce((s, c) => s + c.length, 0)
  const fine = new Uint8Array(22), df = new DataView(fine.buffer)
  df.setUint32(0, 0x06054b50, true); df.setUint16(8, voci.length, true); df.setUint16(10, voci.length, true)
  df.setUint32(12, dimCen, true); df.setUint32(16, offset, true)
  const out = new Uint8Array(new ArrayBuffer(offset + dimCen + 22))
  let p = 0
  for (const x of [...locali, ...centrali, fine]) { out.set(x, p); p += x.length }
  return out
}
