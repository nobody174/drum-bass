# Maskinvare og kabler

Oppdatert 2026-11-09. Priser er omtrentlige og må sjekkes i butikken før kjøp.

## TL;DR

Alesis Nitro Max har en **firkantet USB-B-port** bak på modulen. Den sender MIDI til telefonen. Du trenger enten **én kabel USB-C til USB-B**, eller **vanlig USB-A til USB-B-kabel + OTG-adapter USB-A hunn til USB-C hann**. Telefonen må støtte USB host/OTG (de fleste USB-C-telefoner gjør det).

## Oppsett

```
Nitro Max (USB-B)  --kabel-->  [OTG-adapter]  -->  Android (USB-C)
```

- Slå på modulen med strømadapteren først, og koble til USB etterpå.
- På noen telefoner må OTG slås på i innstillingene.
- Ikke bruk en usb-hub uten strøm.
- Test først med en MIDI-monitor (M0 i `SPEC.md`).

## Alternativ A: én kabel (enklest)

USB-C hann til USB-B hann, USB 2.0 er nok (MIDI trenger lite båndbredde). Velg gjerne 2 m så det rekker til kitet.

| Butikk | Produkt | Merknad |
|---|---|---|
| Kjell & Company | [Plexgear CB231 USB-C til USB-B 2 m](https://www.kjell.com/no/produkter/kabler-og-kontakter/usb-c-kablar-f71106ff/usb-c-til-usb-b) | ca. 200 kr, lager i mange butikker |
| Kjell & Company | Plexgear CB230 / USB-C til USB-B 2.0 1 m (samme kategoriside) | 1 m, kortere |

## Alternativ B: to deler (tryggest, billigst)

1. **USB-A hann til USB-B hann** ("skriverkabel"), 2 m. Mange selger den, ofte under 100 kr. Eksempel på prissammenligning: [Prisjakt, USB-kabler](https://www.prisjakt.no/c/usb-kabler?147=10369) (f.eks. Deltaco Gold USB A - USB B 2.0 2 m, rundt 50 kr).
2. **OTG-adapter, USB-A hunn til USB-C hann** (plugges i telefonen, kabelen i den andre enden):

| Butikk | Produkt |
|---|---|
| Kjell & Company | [Plexgear OTG-adapter USB-A til USB-C](https://www.kjell.com/no/produkter/data/kabler-og-adaptere/usb/usb-adaptere/plexgear-otg-adapter-usb-a-til-usb-c-p64970) (USB-A hunn til USB-C hann) |
| Kjell & Company | [Luxorparts OTG-adapter USB-C til USB-A 0,2 m](https://www.kjell.com/no/produkter/data/kabler-og-adaptere/usb/usb-adaptere/luxorparts-otg-adapter-usb-c-til-usb-a-02-m-p69161) (USB-C hann til USB-A hunn, kort kabel) |
| Proshop | [FIXED Link USB-C Male to USB-A Female adapter](https://www.proshop.no/USB/FIXED-LINK-USB-C-Male-to-USB-A-Female-adapter-Grey/3272417) |
| Deltaco | [USB-C 3.1 til USB-A OTG-adapter](https://deltaco.no/usbc-1277) |

**Pass på retningen:** adapteren skal ha **USB-C hann** (plugg) mot telefonen og **USB-A hunn** (hull) der kabelen settes inn. Kjells "Plexgear OTG-adapter USB-A til USB-C 3.0" (varenr. 64971) har motsatt retning og passer ikke.

## Hvis telefonen ikke finner settet

- Prøv en annen kabel (noen er kun ladekabler).
- Slå på OTG i telefoninnstillinger.
- Prøv en annen USB-port eller adapter.
- Sjekk at modulen er på.
- Chrome må ha tillatelse til MIDI (appen ber om det).

## Åpne punkter

- Bekrefte at nevøens telefon støtter USB host (prøv med et USB-minne eller tastatur via adapteren).
- Nitro Max kan også ha 5-pins MIDI, men USB er enklest. Ikke nødvendig for appen.
