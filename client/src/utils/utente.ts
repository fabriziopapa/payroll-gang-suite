// ============================================================
// PAYROLL GANG SUITE — formattazione dello username a schermo
//
// Un solo posto perche' Dashboard (liquidazioni) ed Emolumenti mostrano la
// stessa cosa: due copie della stessa funzione divergono, e il giorno che si
// cambia il formato in una pagina l'altra resta indietro.
// ============================================================

/**
 * Lo username e' un indirizzo di posta dell'ateneo. In elenco si mostra la
 * parte prima della @, che basta a riconoscere la persona: il dominio,
 * identico su ogni riga, occupa due terzi della stringa e non distingue
 * nessuno. L'indirizzo intero va nel `title`, per chi ha bisogno di quello.
 *
 * `null`/vuoto -> `null`: chi chiama decide se omettere la riga, e non si
 * ritrova una stringa vuota da mostrare.
 */
export function soloUtente(username: string | null | undefined): string | null {
  if (!username) return null
  const i = username.indexOf('@')
  return i > 0 ? username.slice(0, i) : username
}

/**
 * Come sopra, ma se l'utente e' quello collegato scrive `te`.
 *
 * «Modificato da te» si legge meglio di «Modificato da fabrizio.papa» quando
 * fabrizio.papa sei tu — e sostituisce la pillola colorata `Tu` che stava
 * accanto al titolo, dove aveva il peso visivo di un'etichetta di stato.
 */
export function nomeOppureTe(
  username: string | null | undefined,
  userId: string | null | undefined,
  proprioId: string | null | undefined,
): string | null {
  if (!username) return null
  if (userId && proprioId && userId === proprioId) return 'te'
  return soloUtente(username)
}
