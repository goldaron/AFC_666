# Kauppapaikan tukikohdan tason mukaan suodattaminen

## Muutokset

### 1. API-endpoint `/api/market/new` (api_server.py, linjat 375-398)
- **Vanha logiikka**: Palautti kaikki koneiden mallit (paitsi STARTER)
- **Uusi logiikka**: Käyttää GameSessionin metodia `_fetch_aircraft_models_by_base_progress()`, joka suodattaa koneet pelaajan korkeimman tukikohdan tason mukaan
- **Suodatusperiaate**: 
  - SMALL-taso: voi ostaa SMALL-kategorian koneita
  - MEDIUM-taso: voi ostaa SMALL ja MEDIUM kategoriat
  - LARGE-taso: voi ostaa SMALL, MEDIUM, LARGE kategoriat
  - HUGE-taso: voi ostaa kaikki kategoriat (SMALL, MEDIUM, LARGE, HUGE)

### 2. market.js päivitykset
- **loadNewAircraft()**: Parannettu tyhjä tila -viesti, joka neuvoo pelaajaa päivittämään tukikohdan saadakseen lisää koneita
- **createNewAircraftElement()**: Lisätty dokumentaatio suodatuksesta ja parempi kantama-kentän käsittely (käyttää nyt `range_km` API:sta tai fallback-logiikkaa)

## Testaus
- GameSession-metodi palauttaa 15 koneelta SMALL-kategorian malleille save_id=1
- API-endpoint `/api/market/new` palauttaa oikean määrän suodatettuja malleja
- Kaikki koneet palautuivat suodatettuina oikean kategorian mukaan

## Huomattavaa
- Suodatus tapahtuu nyt automaattisesti backend-tasolla
- Frontend (market.js) ei tarvitse muutoksia suodatuslogiikkaan, mutta käyttöliittymä on paranneltu
- Pelaajalle on nyt selvää, että kaupassa näytettävät koneet riippuvat tukikohdan tasosta
