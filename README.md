# Seilplan

Passasjeplanlegging for langtursseiling, laget for Android-nettbrett. Appen virker over hele verden.

Seilplan er et hjelpemiddel for planlegging og ikke et navigasjonssystem. Bruk godkjente sjøkart, kartplotter, offisielle værvarsler og eget skjønn.

## Hva appen gjør

- **Passasje A → B:** Velg start og mål med GPS, ved å trykke i kartet eller ved å søke. Legg inn via-punkter for å styre rundt land, og dra dem i kartet. Appen viser distanse, varighet og ankomst.
- **Værvinduer:** Appen henter vind fra ECMWF, GFS, ICON, GEM og UK Met Office, og bølger, dønning og havstrøm. Ut fra det regner den ut den beste avreisen innenfor dine grenser for vind, kast og bølger, og om du vil unngå kryss.
- **Sammenligning av modeller:** En graf viser vinden der båten er underveis, fra hver modell. Appen sier ifra der modellene er uenige.
- **Syklonsesong:** Appen advarer hvis ruten går gjennom et syklonområde i sesongen.
- **Ankring:** Du ser vinden de neste 1–7 døgnene, hvor du trenger le, om vinden snur, og hvor lang kjetting du trenger. Med egen nøkkel kan du også få AI-råd.
- **I nærheten:**
  - Steder: havner, ankringsplasser, drivstoff, butikker, severdigheter og historie.
  - Aktiviteter: utleie av blant annet vannscooter, ATV, båt og sykkel, turer og guider, og opplevelser.
  - Arrangementer og festivaler: AI-søk eller Ticketmaster, pluss lenker til bookingtjenester.
- **Uten nett:** Varsler, steder og kartfliser du har sett lagres på nettbrettet og kan brukes uten forbindelse.
- **Nattlys:** Dempet rødt lys som bevarer nattsynet.

## Legg appen ut på nettet (gratis)

Appen må ligge på en adresse med https, ellers får den ikke bruke GPS. Det enkleste er GitHub Pages:

1. Lag en gratis konto på github.com.
2. Lag et nytt repository som heter `seilplan`. Det må være **Public**.
3. Velg **Add file → Upload files**, og dra inn alt innholdet i denne mappen: `index.html`, `sw.js`, `manifest.webmanifest` og mappene `css`, `js` og `icons`. Trykk **Commit changes**.
4. Gå til **Settings → Pages**. Under **Branch**, velg `main` og `/ (root)`, og trykk **Save**.
5. Etter et par minutter ligger appen på `https://BRUKERNAVN.github.io/seilplan/`.

Kobler du GitHub til Claude, kan Claude legge ut nye versjoner for deg.

## Installer på Android-nettbrettet

1. Åpne adressen i **Chrome**.
2. Trykk **⋮ → Installer app** (eller **Legg til på startsiden**).
3. Åpne Seilplan fra startsiden, og tillat posisjon når appen spør.

## Før du drar ut

- Hent værvarsel for ruten mens du har nett. Med Starlink kan du hente nye varsler underveis.
- Bla gjennom kartet over områdene du skal til, på de zoomnivåene du trenger. Da lagres kartflisene og kan brukes uten nett.
- Gå gjennom grensene dine under ⚙ (maks vind, kast og bølgehøyde).

## Valgfrie nøkler (under ⚙)

- **Anthropic API-nøkkel** (console.anthropic.com): gir AI-råd om ankring og AI-søk etter arrangementer og turer. For at søket skal virke, må websøk være slått på i Anthropic-kontoen.
- **Ticketmaster API-nøkkel** (developer.ticketmaster.com, gratis): gir konserter, festivaler og sport med dato.

Nøklene lagres bare på nettbrettet.

## Datakilder

- **Kart:** © OpenStreetMap-bidragsytere, med sjømerker fra OpenSeaMap.
- **Vær:** Open-Meteo, med data fra ECMWF, NOAA, DWD, ECCC og UK Met Office. Gratis for ikke-kommersiell bruk.
- **Steder og aktiviteter:** OpenStreetMap (via Overpass) og Wikipedia.
- **Stedsøk:** Nominatim.
