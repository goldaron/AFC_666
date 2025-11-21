# API Suunnitelma: Air Freight Company 666 - Web-versio

Tämä dokumentti määrittelee Flask-pohjaisen REST API:n, joka toimii backendinä Air Freight Company 666 -pelin selainversiolle. Rajapinta mahdollistaa olemassa olevan pelilogiikan hyödyntämisen ja tarjoaa tarvittavat toiminnot frontendille.

## 1. Teknologiat

- **Backend:** Python + Flask
- **Tietokanta:** MariaDB
- **Frontend:** HTML, CSS, JavaScript (kommunikoi tämän APIn kanssa)

## 2. Arkkitehtuuri

Noudatamme klassista client-server-arkkitehtuuria.
- **Flask-sovellus (Backend):** Käsittelee HTTP-pyynnöt, soveltaa pelilogiikkaa (`game_session.py` ja muut) ja kommunikoi MariaDB-tietokannan kanssa.
- **Selain (Frontend):** Lähettää pyyntöjä Flask-sovellukselle ja esittää datan käyttäjälle. Käyttäjän toiminnot (napin painallukset yms.) kääntyvät API-kutsuiksi.

## 3. Rajapinnan Endpoints (REST API)

Kaikki vastaukset ovat JSON-muodossa. Virhetilanteissa käytetään standardeja HTTP-statuskoodeja (4xx ja 5xx).

### Pelin Hallinta

- `GET /api/game`: Hakee nykyisen pelisession tilan.
  - Vastaus: `{ "day": 1, "cash": 300000.00, "playerName": "Testi", "status": "ACTIVE" }`
- `GET /api/games`: Listaa kaikki tallennetut pelit.
  - Vastaus: `[{ "save_id": 1, "player_name": "Testi", ... }, ...]`
- `POST /api/games`: Luo uuden pelin.
  - Pyyntö: `{ "playerName": "Pelaaja1", "startingCash": 500000, "rngSeed": 123 }`
  - Vastaus: Uuden pelin tiedot ja sijainti (`Location` header).
- `POST /api/games/{id}/load`: Lataa ja aktivoi tietty peli.
  - Vastaus: Pelin tila.

### Päivän Kulku

- `POST /api/game/advance-day`: Siirtää pelin seuraavaan päivään.
  - Vastaus: Yhteenveto päivän tapahtumista (saapuneet lennot, tulot, laskut).
- `POST /api/game/fast-forward`: Pikakelaa, kunnes seuraava lento saapuu.
  - Vastaus: Yhteenveto kelatuista päivistä ja pysähtymisen syy.

### Laivasto & Kauppapaikka

- `GET /api/aircrafts`: Listaa pelaajan omistamat koneet.
- `GET /api/aircrafts/{id}`: Hakee yksittäisen koneen tiedot.
- `POST /api/aircrafts/{id}/repair`: Korjaa koneen.
- `POST /api/aircrafts/{id}/upgrade`: Päivittää konetta (esim. ECO).
- `GET /api/market/new`: Listaa myynnissä olevat uudet konemallit.
- `GET /api/market/used`: Listaa käytettyjen koneiden markkinapaikan.
- `POST /api/market/buy`: Osta kone (joko uusi tai käytetty).
  - Pyyntö: `{ "type": "new", "model_code": "C-130" }` tai `{ "type": "used", "market_id": 42 }`

### Tehtävät (Contracts)

- `GET /api/tasks`: Listaa aktiiviset tehtävät.
- `GET /api/aircrafts/{id}/task-offers`: Hakee uusia tehtävätarjouksia tietylle koneelle.
- `POST /api/tasks`: Hyväksyy ja aloittaa uuden tehtävän.
  - Pyyntö: `{ "aircraft_id": 5, "offer_id": 101 }`

### Tukikohdat (Bases)

- `GET /api/bases`: Listaa pelaajan omistamat tukikohdat.
- `POST /api/bases`: Osta uusi tukikohta.
  - Pyyntö: `{ "icao_code": "KJFK" }`
- `POST /api/bases/{id}/upgrade`: Päivitä tukikohdan tasoa.

### Muut

- `GET /api/events`: Hakee pelin tapahtumalokin.
- `GET /api/clubhouse`: Pääsy salaiseen kerhohuoneeseen.
- `POST /api/clubhouse/play`: Pelaa minipeliä kerhohuoneella.
  - Pyyntö: `{ "game": "coin_flip", "bet": 1000, "choice": "kruuna" }`

## 4. Tehtävien jako (4 henkilöä) - Päivitetty

Jokainen kehittäjä vastaa oman ominaisuuskokonaisuutensa toteuttamisesta **sekä backend-rajapintojen että frontend-näkymien osalta**. Tämä takaa, että kaikki pääsevät tekemään täyden stackin kehitystä.

### Kehittäjä 1: Pelin elinkaari ja perustila
- **Backend (Flask):**
  - `POST /api/games`: Uuden pelin luonti.
  - `GET /api/games`: Tallennettujen pelien listaus.
  - `POST /api/games/{id}/load`: Pelin lataaminen.
  - `GET /api/game`: Aktiivisen pelin perustietojen haku (päivä, raha, status).
- **Frontend (HTML/JS/CSS):**
  - Aloitusnäyttö, jossa "Uusi peli" ja "Lataa peli" -painikkeet.
  - Näkymä tallennettujen pelien listalle, josta voi valita ladattavan pelin.
  - Päänäkymän "dashboard" tai yläpalkki, joka näyttää jatkuvasti pelin perustiedot.

### Kehittäjä 2: Pelin eteneminen ja tapahtumat
- **Backend (Flask):**
  - `POST /api/game/advance-day`: Päivän siirto eteenpäin.
  - `POST /api/game/fast-forward`: Pikakelaus seuraavaan tapahtumaan.
  - `GET /api/events`: Tapahtumalokin haku.
- **Frontend (HTML/JS/CSS):**
  - Päänäkymän kontrollit päivän siirtämiselle ja pikakelaukselle.
  - Modaali-ikkuna tai ilmoitusalue, joka näyttää päivän vaihtuessa tapahtuneet asiat (esim. koneiden saapumiset, lasketut laskut).
  - Erillinen sivu tai komponentti tapahtumalokin selaamiseen.

### Kehittäjä 3: Laivaston ja omaisuuden hallinta
- **Backend (Flask):**
  - `GET /api/aircrafts`: Omistettujen lentokoneiden listaus.
  - `GET /api/aircrafts/{id}`: Yksittäisen koneen tarkemmat tiedot.
  - `POST /api/aircrafts/{id}/repair`: Koneen korjaaminen.
  - `POST /api/aircrafts/{id}/upgrade`: Koneen ECO-päivitys.
  - `GET /api/bases`: Omistettujen tukikohtien listaus.
  - `POST /api/bases/{id}/upgrade`: Tukikohdan päivitys.
- **Frontend (HTML/JS/CSS):**
  - "Laivasto"-näkymä, joka listaa kaikki koneet ja niiden perustiedot.
  - Yksittäisen koneen näkymä, jossa näkyy tarkemmat tiedot sekä painikkeet korjaukselle ja päivitykselle.
  - "Tukikohdat"-näkymä, jossa voi hallita ja päivittää omia tukikohtia.

### Kehittäjä 4: Tehtävät ja kaupankäynti
- **Backend (Flask):**
  - `GET /api/tasks`: Aktiivisten tehtävien listaus.
  - `GET /api/aircrafts/{id}/task-offers`: Uusien tehtävätarjouksien haku koneelle.
  - `POST /api/tasks`: Uuden tehtävän hyväksyminen.
  - `GET /api/market/new` & `GET /api/market/used`: Uusien ja käytettyjen koneiden listaus kauppapaikalla.
  - `POST /api/market/buy`: Koneen ostaminen markkinoilta.
  - Bonus: `GET/POST /api/clubhouse/...`: Salaisen kerhohuoneen toiminnot.
- **Frontend (HTML/JS/CSS):**
  - "Tehtävät"-näkymä, joka näyttää aktiiviset ja saatavilla olevat tehtävät.
  - "Kauppapaikka"-näkymä, josta voi selata ja ostaa uusia sekä käytettyjä koneita.
  - Bonus: Kerhohuoneen pelinäkymä.
