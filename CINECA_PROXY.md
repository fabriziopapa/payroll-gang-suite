# Proxy Italia per API CINECA CSA-WS

## Perché

CINECA geo-blocca gli IP extra-UE: da VPS fuori Italia le connessioni a
`prod.csa-ws.cineca.it:443` vanno in TCP timeout (drop a livello firewall,
verificato 2026-07-01: da IP italiano `200 OK`, da IP extra-UE timeout).

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

## ⚠️ Il firewall del cloud provider: la trappola ricorrente

`iptables` sulla VM **non basta**. I provider cloud filtrano il traffico a monte, prima che
arrivi alla macchina: su Oracle Cloud sono le *Security List* del VCN (o il *Network Security
Group* associato alla VNIC), su AWS i Security Group, su Hetzner le Firewall Rules. Una regola
chiusa lì produce un **drop silenzioso**: nessun `connection refused`, solo un timeout.

Ci siamo cascati due volte, con lo stesso sintomo e cause diverse:

- **2026-07-27** — la 443 era aperta in `iptables` ma **chiusa nella Security List**. La 80 era
  aperta (per questo Caddy aveva ottenuto il certificato ACME e sembrava a posto), la 443 no.
  Dall'app: timeout. Dalla VM stessa: pure timeout, ma per un motivo diverso e fuorviante —
  vedi la nota sull'hairpin qui sotto.
- **2026-08-16** — un secondo server applicativo, con IP diverso, non riusciva a raggiungere il
  proxy: `504 CINECA_UNREACHABLE`. La regola di ingress esisteva ma autorizzava **solo l'IP del
  primo server**.

**Regola pratica: ogni server applicativo che deve usare il proxy ha bisogno della propria
regola di ingress TCP 443**, con il suo `/32`. Su Oracle: *Networking → Virtual Cloud Networks →
&lt;VCN&gt; → Subnets → &lt;subnet della VM&gt; → Security Lists → Add Ingress Rules*, con
Stateful, Source Type `CIDR`, Source CIDR `<IP-DEL-SERVER>/32`, IP Protocol `TCP`, Destination
Port Range `443`. Se la VM usa un NSG sulla VNIC, la regola va messa lì.

Diagnosi in un comando, **dal server applicativo**:

```bash
curl -s -o /dev/null -w '%{http_code} in %{time_total}s\n' --max-time 15 \
  https://cineca-proxy.tuodominio.it/
```

| Risultato | Significato |
|---|---|
| `403` in meno di un secondo | il proxy è raggiungibile e funziona (403 è corretto: manca `X-Proxy-Auth`) |
| `000` dopo il timeout pieno | il pacchetto viene scartato a monte: firewall del cloud provider |
| `connection refused` immediato | Caddy è fermo, oppure non è in ascolto sulla 443 |

> **Non fidarsi dei test eseguiti dalla VM del proxy verso sé stessa.** Il nome
> `cineca-proxy.tuodominio.it` risolve all'IP pubblico della VM, e Oracle non fa NAT reflection
> (hairpin): la VM non riesce a contattare il proprio IP pubblico e va in timeout anche quando
> tutto funziona. A luglio questo ha prodotto una diagnosi sbagliata durata un giorno. Per
> testare Caddy dall'interno si usa `--resolve`:
>
> ```bash
> curl -sv --resolve cineca-proxy.tuodominio.it:443:127.0.0.1 \
>   https://cineca-proxy.tuodominio.it/ -o /dev/null
> ```

## Serve davvero il proxy?

Solo se l'IP del server applicativo è geo-bloccato da CINECA. Da un IP italiano la chiamata
diretta funziona ed è **più veloce**: misurato il 2026-07-27, liquidato diretto `200` in 0,28 s
contro 0,41 s via proxy. Il proxy è un ripiego contro il geo-blocco, non un miglioramento.

Prima di aprire regole di firewall per un nuovo server, prova quindi la strada più semplice:
mettere `cinecaUseProxy` a `false` in *Impostazioni → Moduli*. Se le chiamate dirette
funzionano, il proxy non serve a quel server e non c'è alcuna configurazione da aggiungere.

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
