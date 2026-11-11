// ============================================================
// PAYROLL GANG SUITE — Vista Fluida (26.11.11.3)
//
// Il contenitore di pagina che usa tutto lo spazio disponibile, con un
// margine che cresce con lo schermo (e quindi con lo zoom del browser):
// niente larghezza massima fissa, quindi niente vuoto ai lati quando si
// riduce lo zoom o su monitor larghi; a zoom alto o sul telefono la pagina
// e' semplicemente stretta e si adatta come su mobile.
//
// Regole (stili .pgs-fluida in index.css):
//   · margine laterale fluido: clamp(0,75rem, 2,5vw, 3rem), piu' le aree
//     sicure dei telefoni (notch, barra di sistema);
//   · NON e' un contenitore per le container query (container-type): in
//     alcuni browser renderebbe le finestre «fixed» (Modale) relative alla
//     pagina invece che allo schermo. Si usano media query e griglie auto-fit;
//   · schede del modulo (.pgs-schede): sotto 48rem scorrono in orizzontale;
//   · testo da leggere (paragrafi lunghi): .pgs-lettura, max 75 caratteri;
//   · tocco (pointer: coarse): pulsanti e campi di almeno 44 px, testo dei
//     campi a 16 px (iPhone altrimenti ingrandisce la pagina al tocco);
//   · caratteri mai in vw (devono seguire lo zoom: WCAG 1.4.4).
//
// Per ora la usa il modulo CRAL. Per portarla su un'altra pagina: sostituire
// il suo `max-w-… mx-auto` con <VistaFluida> e provarla a zoom 50–400%.
// ============================================================

import type { ReactNode } from 'react'

export function VistaFluida({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`pgs-fluida ${className}`}>{children}</div>
}
