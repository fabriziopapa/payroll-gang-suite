# PAYROLL GANG SUITE — Installazione nuova VPS

Due percorsi alternativi, entrambi completi (clone → avvio → hardening):

| Guida | Quando |
|---|---|
| **[INSTALL_VPS_AAPANEL.md](INSTALL_VPS_AAPANEL.md)** | Gestione via pannello web aaPanel (come VPS attuale) |
| **[INSTALL_VPS_NATIVE.md](INSTALL_VPS_NATIVE.md)** | Setup nativo Ubuntu 24.04 LTS senza pannello (nginx + PM2 + PostgreSQL da apt) — più leggero, tutto via SSH |

Entrambe coprono:
- **Scenario B** — migrazione dati dalla VPS attuale (`pg_dump` + `.env` originale)
- **Cambio dominio** — checklist Cloudflare + Turnstile + rebuild client
- **Hardening avanzato** — SSH, firewall (Cloudflare-only), fail2ban, aggiornamenti automatici
- **CINECA** — nuova VPS in UE = chiamate dirette; proxy Italia resta configurabile come fallback → [CINECA_PROXY.md](CINECA_PROXY.md)

> ⚠️ **Vincolo critico migrazione:** il DB contiene dati cifrati AES-256-GCM
> (TOTP secret, CF, certificati). Serve il `.env` originale con la **stessa
> `ENCRYPTION_KEY`** — mai rigenerarla, o quei dati sono irrecuperabili.

Database: unico file consolidato [server/sql/setup.sql](server/sql/setup.sql) (17 tabelle, idempotente, verificato 1:1 contro produzione il 2026-07-02).
