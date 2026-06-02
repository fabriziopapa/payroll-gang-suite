// ============================================================
// PAYROLL GANG SUITE — Tipi template/merge certificato
// Il template è un DATO (strutturaJson in templati_certificato), editabile
// da UI. Qui i tipi che lo descrivono e i metadati operatore.
// ============================================================

/** Riga della tabella emolumenti: voce statica + segno + sorgente dato. */
export interface RigaEmolumento {
  voce:  string
  segno: string          // "(+)" | "(-)" | "(=)"
  /** path nel contesto resolve: "teo.stipendio" | "cert.ritenute_fiscali" … */
  src:   string
  bold?: boolean
}

/** Regola di matching voce teorica → campo template (CONFIGURABILE, fix #5). */
export interface MatchTeorica {
  field:    string       // es. "stipendio", "iis", "ivc"
  keywords: string[]     // match case-insensitive su descrizione voce teorica
}

/** Struttura completa di un template (= strutturaJson). */
export interface CertificatoTemplate {
  bollo:        { testo: string }
  intestazione: { protocollo: string; posizione: string }
  titolo:       string
  corpo:        string[]
  tabellaEmolumenti:  RigaEmolumento[]
  testoExtraerariali: string
  testoNetto:   string
  chiusura:     string
  luogoData:    string
  firma:        string[]
  /** Regole configurabili (non più hardcoded nel codice) */
  matchTeoriche:    MatchTeorica[]
  inquadramentoMap: Record<string, string>
  extraRename:      Record<string, string>
}

/** Metadati operatore forniti dall'UE al momento della generazione. */
export interface CertificatoMeta {
  protocollo:      string
  sigla_operatore: string
  data_rilascio:   string
  dirigente:       string
  /** override genere manuale ('M' | 'F'); se assente dedotto dal CF */
  sesso?:          'M' | 'F'
}
