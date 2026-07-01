# Proxy Italia per API CINECA CSA-WS

## Perché

CINECA geo-blocca gli IP extra-UE: da VPS fuori Italia le connessioni a
`prod.csa-ws.cineca.it:443` vanno in TCP timeout (drop a livello firewall,
verificato 2026-07-01: da IP italiano `200 OK`, da Hong Kong timeout).

Soluzione: micro-VPS in Italia con **Caddy** come reverse proxy autenticato.
Solo le chiamate CSA-WS passano dal proxy; il resto dell'app resta invariato.

```
App (VPS HK) ──HTTPS + X-Proxy-Auth──▶ Caddy (VPS Italia) ──HTTPS──▶ prod.csa-ws.cineca.it
```

## Requisiti GDPR

- TLS end-to-end su entrambe le tratte (mai HTTP in chiaro: transitano CF).
- **Nessun log dei body** — Caddy di default non logga i body; non abilitarli.
- Proxy in datacenter UE (Italia): nessun trasferimento extra-UE aggiuntivo.
- Secret forte (≥32 char): il proxy non deve essere un open relay verso CINECA.

## Setup VPS Italia (una tantum)

VPS minimo (1 vCPU / 512 MB): Oracle Cloud Milano free tier, Aruba Cloud (~3 €/mese), ecc.
Serve un sottodominio, es. `cineca-proxy.tuodominio.it` → A record sull'IP del VPS.

```bash
# 1. Installa Caddy (Debian/Ubuntu)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# 2. Genera il secret (annotalo: va anche nel .env dell'app)
openssl rand -hex 32

# 3. Secret come variabile d'ambiente del servizio Caddy
sudo systemctl edit caddy
#   [Service]
#   Environment="CINECA_PROXY_SECRET=<il-secret-generato>"
```

`/etc/caddy/Caddyfile`:

```caddyfile
cineca-proxy.tuodominio.it {
	# Solo richieste con il secret corretto — tutto il resto 403
	@authorized header X-Proxy-Auth {$CINECA_PROXY_SECRET}

	handle @authorized {
		reverse_proxy https://prod.csa-ws.cineca.it {
			header_up Host prod.csa-ws.cineca.it
			# Il secret non deve arrivare a CINECA
			header_up -X-Proxy-Auth
		}
	}

	handle {
		respond "Forbidden" 403
	}

	# GDPR: log di accesso minimale, nessun body. Per zero-log: rimuovere il blocco.
	log {
		output file /var/log/caddy/cineca-proxy.log {
			roll_size 10mb
			roll_keep 3
		}
	}
}
```

```bash
sudo systemctl restart caddy

# 4. Test dal VPS HK (deve rispondere 200 con token):
curl -s -X POST https://cineca-proxy.tuodominio.it/uniparthenope/authentication \
  -H "X-Proxy-Auth: <secret>" -H "Content-Type: application/json" \
  -d '{"username":"...","password":"...","group":"familiari,sge"}'

# Senza header deve rispondere 403:
curl -s -o /dev/null -w "%{http_code}" https://cineca-proxy.tuodominio.it/x
```

TLS automatico via Let's Encrypt (Caddy lo gestisce da solo).
Firewall VPS: aprire solo 80/443 (80 serve per la challenge ACME) + SSH.

## Configurazione app

`.env` del server (VPS HK):

```env
CINECA_PROXY_URL=https://cineca-proxy.tuodominio.it
CINECA_PROXY_SECRET=<lo-stesso-secret-del-Caddy>
```

Poi da **Impostazioni → Moduli → "Proxy Italia per API CINECA"** (solo admin):
il toggle attiva/disattiva l'instradamento a runtime, persiste in `app_settings`
(chiave `cinecaUseProxy`) e viene ripristinato al riavvio del server.
Se il toggle è ON ma le variabili `.env` mancano, il server rifiuta con 400.

## Note

- Il token JWT CSA-WS viene invalidato al cambio di modalità (re-auth automatica).
- `CINECA_BASE_URL` resta configurato: con toggle OFF le chiamate tornano dirette.
- Rotazione secret: rigenerare, aggiornare systemd del Caddy + `.env` app, restart entrambi.
