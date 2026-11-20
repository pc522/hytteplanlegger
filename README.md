# Hytteplanleggeren

Oversikt over DNT-hytter, åpningstider og ledighet, med en enkel turplanlegger.

- `index.html` er hele appen (én fil, ingen bygging).
- `data/ledighet.json` er ledigheten fra hyttebestilling.dnt.no som vises i fanen Ledighet. Den oppdateres hver morgen av en planlagt oppgave. Helger som er passert skjules av siden.
- Oppholdene brukeren legger inn lagres bare i nettleseren (localStorage).

## Format på `data/ledighet.json`

```json
{
  "fetched": "20. november 2026 kl. 07:17",
  "hentet": "2026-11-20T07:17:00+01:00",
  "omrader": ["Oslomarka", "Finse og Hardangervidda"],
  "weeks": [
    {
      "from": "2026-11-27",
      "to": "2026-11-29",
      "rows": [
        { "id": "om-vikkelihytta", "name": "Vikkelihytta", "area": "Oslomarka", "areaId": 1223,
          "free": 9, "total": 9, "price": 3450 }
      ]
    }
  ]
}
```

- Én uke per helg: `from` er fredag, `to` er søndag (2 netter).
- Én rad per hytte som har minst én ledig seng (eller hele hytta ledig) den helgen. Hytter uten ledighet tas ikke med.
- `free` og `total` er ledige og totale senger. Bruk `null` for begge hvis hytta bookes som helhet.
- `price` er portalens laveste pris for oppholdet i hele kroner, eller `null`.
- `areaId` er områdets id i portalens kart-URL (`/kart?value=<id>&type=area`).
- `id` er en kort slug av navnet. Oslomarka-hytter har prefikset `om-`. Gjenbruk id-ene som allerede finnes i filen.
- Det finnes ingen gjestetall. Ledigheten gjelder totalt antall senger.
