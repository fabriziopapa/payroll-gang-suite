// ============================================================
// PAYROLL GANG SUITE — Rubrica d'Ateneo · certificato intermedio
//
// Il server www.uniparthenope.it:8443 invia solo il proprio certificato,
// senza l'intermedio che lo ha firmato: Node (come curl e Python) non
// riesce a completare la catena e rifiuta la connessione
// (UNABLE_TO_VERIFY_LEAF_SIGNATURE). Invece di spegnere la verifica, si
// aggiunge l'intermedio mancante, SOLO per le chiamate alla rubrica.
//
//   GEANT TLS ECC 1 (HARICA), firmato da HARICA TLS ECC Root CA 2021
//   valido dal 03/01/2025 al 31/12/2039
//   SHA-256 6C:DF:0B:A1:71:1E:85:6D:22:8B:A0:0C:A0:4C:5C:1C:
//           3D:79:94:4C:03:7B:71:3B:15:5A:4E:E4:B4:7E:C5:3C
//   fonte: http://crt.harica.gr/HARICA-GEANT-TLS-E1.cer (indicato nel
//   certificato del server, campo Authority Information Access)
//
// E' un certificato pubblico, non un segreto. La radice resta quella
// dell'elenco di Node: se l'intermedio fosse falso, la verifica fallirebbe.
// ============================================================

/** Impronta attesa: all'avvio si confronta con quella del PEM qui sotto (rubricaAteneo.ts). */
export const IMPRONTA_GEANT_TLS_ECC_1 = '6C:DF:0B:A1:71:1E:85:6D:22:8B:A0:0C:A0:4C:5C:1C:3D:79:94:4C:03:7B:71:3B:15:5A:4E:E4:B4:7E:C5:3C'

export const GEANT_TLS_ECC_1 = `-----BEGIN CERTIFICATE-----
MIIDNzCCArygAwIBAgIQQv3c4SYWB+Gl5pNaQAFh3TAKBggqhkjOPQQDAzBsMQsw
CQYDVQQGEwJHUjE3MDUGA1UECgwuSGVsbGVuaWMgQWNhZGVtaWMgYW5kIFJlc2Vh
cmNoIEluc3RpdHV0aW9ucyBDQTEkMCIGA1UEAwwbSEFSSUNBIFRMUyBFQ0MgUm9v
dCBDQSAyMDIxMB4XDTI1MDEwMzExMTQyMVoXDTM5MTIzMTExMTQyMFowYDELMAkG
A1UEBhMCR1IxNzA1BgNVBAoMLkhlbGxlbmljIEFjYWRlbWljIGFuZCBSZXNlYXJj
aCBJbnN0aXR1dGlvbnMgQ0ExGDAWBgNVBAMMD0dFQU5UIFRMUyBFQ0MgMTB2MBAG
ByqGSM49AgEGBSuBBAAiA2IABANPWLwh0Za2UqtbLV7/qNRm78zsttgSuvhn73bU
GtxETsVOEZeMUfMjgHw8EwrsSJI9oj0CgZQFFSEY1NJfcxA/NJiOYJUKPsFbpOrY
dr0q4g+aBZsXWeh7bMCzx24g/aOCAS0wggEpMBIGA1UdEwEB/wQIMAYBAf8CAQAw
HwYDVR0jBBgwFoAUyRtTgRL+BNUW0aq8mm+3oJUZbsowTQYIKwYBBQUHAQEEQTA/
MD0GCCsGAQUFBzAChjFodHRwOi8vY3J0LmhhcmljYS5nci9IQVJJQ0EtVExTLVJv
b3QtMjAyMS1FQ0MuY2VyMBEGA1UdIAQKMAgwBgYEVR0gADAdBgNVHSUEFjAUBggr
BgEFBQcDAgYIKwYBBQUHAwEwQgYDVR0fBDswOTA3oDWgM4YxaHR0cDovL2NybC5o
YXJpY2EuZ3IvSEFSSUNBLVRMUy1Sb290LTIwMjEtRUNDLmNybDAdBgNVHQ4EFgQU
6ZkGjRcfq/uWGlrIW15dXuzanI8wDgYDVR0PAQH/BAQDAgGGMAoGCCqGSM49BAMD
A2kAMGYCMQD2M1caaY2OwmthgmANUQg3LBLI0/2LiCdxa2zNq0G59wVzbjEk0cR/
px52OegIwRACMQCk+iTmBlR6Xfv6igiiaFiPYfN2HfbcYLWbot5DZ2H1b4JVJV+V
rga7uu50SDG9hf4=
-----END CERTIFICATE-----
`
