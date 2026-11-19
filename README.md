# Hytteplanleggeren

Oversikt over DNT-hytter, åpningstider og ledighet, med en enkel turplanlegger.

- `index.html` er hele appen (én fil, ingen bygging).
- `data/ledighet.json` er øyeblikksbildet fra hyttebestilling.dnt.no som vises i fanen Ledighet. Oppdater denne filen for å vise ny ledighet. Helger som er passert skjules automatisk.
- Oppholdene brukeren legger inn lagres bare i nettleseren (localStorage).
