"""Flask-pohjainen rajapinta"""

import os
import math
import random
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from flask import Flask, jsonify, request, send_from_directory

from event_system import get_event_for_day
from game_session import GameSession
from utils import get_connection

app = Flask(__name__, static_folder='static')
# Tämä kertoo minkä tallennuksen tietoja API lukee; oletuksena käytetään slot 1:tä.
ACTIVE_SAVE_ID = int(os.environ.get("AFC_ACTIVE_SAVE_ID", 1))
# Näin monta tarjousta pyydetään kerralla GameSessionilta.
DEFAULT_TASK_OFFER_COUNT = 5

#Lentokoneiden varten funktiot
from session_helpers import (
    fetch_player_aircrafts_with_model_info,
    get_current_aircraft_upgrade_state,
    calc_aircraft_upgrade_cost,
    apply_aircraft_upgrade,
    get_effective_eco_for_aircraft,
    fetch_owned_bases,
    fetch_base_current_level_map,
    insert_base_upgrade,
)
from upgrade_config import REPAIR_COST_PER_PERCENT

# ---------- Apufunktiot ----------

def _decimal_to_string(value: Any) -> Optional[str]:
    """Palauttaa Decimal-arvon tasamuotoisena tekstinä."""
    if value is None:
        return None
    if isinstance(value, Decimal):
        return format(value, "f")
    return str(value)


def _query_dicts(sql: str, params: Optional[tuple] = None) -> List[Dict[str, Any]]:
    """Suorittaa kyselyn ja palauttaa tulokset sanakirjoina."""
    # Pidetään kyselyt yksinkertaisina: jokainen kutsu avaa ja sulkee oman yhteyden.
    yhteys = get_connection()
    kursori = None
    try:
        kursori = yhteys.cursor(dictionary=True)
        kursori.execute(sql, params or ())
        rows = kursori.fetchall() or []
        return [dict(r) for r in rows]
    finally:
        if kursori is not None:
            try:
                kursori.close()
            except Exception:
                pass
        yhteys.close()


def _fetch_one_dict(sql: str, params: tuple) -> Optional[Dict[str, Any]]:
    """Hakee yhden rivin (tai None)."""
    results = _query_dicts(sql, params)
    return results[0] if results else None


def _serialize_task_row(row: Dict[str, Any]) -> Dict[str, Any]:
    """Muuttaa sopimusrivin JSON-kelpoiseksi paketiksi."""
    return {
        "contractId": row.get("contractId"),
        "aircraft": row.get("registration"),
        "destination": row.get("dest_ident"),
        "payloadKg": row.get("payload_kg"),
        "reward": _decimal_to_string(row.get("reward")),
        "penalty": _decimal_to_string(row.get("penalty")),
        "deadlineDay": row.get("deadline_day"),
        "status": row.get("status"),
        "flight": {
            "arrivalDay": row.get("arrival_day"),
            "delayMinutes": row.get("schedule_delay_min"),
            "status": row.get("flight_status"),
        },
    }


def _serialize_offer(offer: Dict[str, Any]) -> Dict[str, Any]:
    """Paketoidaan tarjouselementti selkeään muotoon."""
    return {
        "dest_ident": offer.get("dest_ident"),
        "dest_name": offer.get("dest_name"),
        "payload_kg": offer.get("payload_kg"),
        "distance_km": int(offer.get("distance_km", 0)),
        "trips": offer.get("trips"),
        "total_days": offer.get("total_days"),
        "reward": _decimal_to_string(offer.get("reward")),
        "penalty": _decimal_to_string(offer.get("penalty")),
        "deadline": offer.get("deadline"),
    }


def _fetch_plane(aircraft_id: int) -> Optional[Dict[str, Any]]:
    """Hakee koneen perustiedot tarjousten luontia varten."""
    # Tarvitsemme koneen mallin ja sijainnin, jotta GameSession osaa antaa järkevät tarjoukset.
    return _fetch_one_dict(
        """
        SELECT a.aircraft_id,
               a.registration,
               a.current_airport_ident,
               a.status,
               am.model_code,
               am.model_name,
               am.base_cargo_kg,
               am.cruise_speed_kts,
               am.eco_fee_multiplier
        FROM aircraft a
                 JOIN aircraft_models am ON am.model_code = a.model_code
        WHERE a.save_id = %s AND a.aircraft_id = %s
        """,
        (ACTIVE_SAVE_ID, aircraft_id),
    )


# ---------- Reitit: Yleiset ----------

@app.get("/api/game")
def get_game_status():
    """Palauttaa pelin yleistilanteen yläpalkkia varten."""
    try:
        session = GameSession(save_id=ACTIVE_SAVE_ID)
        
        # Haetaan kotitukikohta
        primary_base = session._get_primary_base()
        home_base_ident = primary_base["base_ident"] if primary_base else "-"

        return jsonify({
            "playerName": session.player_name,
            "cash": _decimal_to_string(session.cash),
            "day": session.current_day,
            "homeBase": home_base_ident,
            "status": session.status
        })
    except Exception:
        app.logger.exception("Pelin tilan haku epäonnistui")
        return jsonify({"virhe": "Pelin tilan haku epäonnistui"}), 500


# ============================================================================
# TEHTÄVÄT JA KAUPANKÄYNTI
# ============================================================================
# Tämä sektio vastaa lentokoneiden lentosopimusten (contracts) ja kaupankäynnin
# hallinnasta. Sovellus käyttää GameSession-logiikan metodeja, ei duplikoi sääntöjä.
#
# ENDPOINTIT:
# - GET /api/tasks              → Listaa aktiiviset sopimukset
# - GET /api/aircrafts/{id}/task-offers → Generoi tarjouksia koneelle
# - POST /api/tasks             → Hyväksy uusi sopimus
# - GET /api/market/new         → Listaa uudet konemallit (tukikohdan taso rajaa)
# - GET /api/market/used        → Listaa käytettyjen koneiden markkinat
# - POST /api/market/buy        → Osta kone (uusi tai käytetty)
# - GET/POST /api/clubhouse     → Kerhohuoneen minipelit
# ============================================================================

# ---------- Reitit: Tehtävät ----------

@app.get("/api/tasks")
def list_tasks():
    """
    Listaa aktiiviset sopimukset (ACCEPTED, IN_PROGRESS).
    
    Tämä rajapinta hakee kaikki aktiiviset lentosopimusrivit tietokannasta.
    Yhdistetään aircraft- ja flights-tauluihin, jotta saadaan koneen rekisteri
    ja lennon saapumispäivä sekä muut lennon yksityiskohdat.
    
    Vastaus JSON-muodossa:
    {
        "tehtavat": [
            {
                "contractId": 1,
                "aircraft": "OH-ABC",
                "destination": "EGLL",
                "payloadKg": 1000,
                "reward": "5000.00",
                "penalty": "500.00",
                "deadlineDay": 15,
                "status": "ACCEPTED",
                "flight": {"arrivalDay": 12, "delayMinutes": 0, "status": "IN_FLIGHT"}
            }
        ]
    }
    """
    # Näytetään vain aktiiviset sopimukset, koska vanhoista ei ole hyötyä UI:lle.
    try:
        rows = _query_dicts(
            """
            SELECT c.contractId,
                   c.payload_kg,
                   c.reward,
                   c.penalty,
                   c.deadline_day,
                   c.status,
                   c.ident AS dest_ident,
                   a.registration,
                   f.arrival_day,
                   f.schedule_delay_min,
                   f.status AS flight_status
            FROM contracts c
                     LEFT JOIN aircraft a ON a.aircraft_id = c.aircraft_id
                     LEFT JOIN flights f ON f.contract_id = c.contractId
            WHERE c.save_id = %s
              AND c.status IN ('ACCEPTED', 'IN_PROGRESS')
            ORDER BY c.deadline_day ASC, c.contractId ASC
            """,
            (ACTIVE_SAVE_ID,),
        )
        return jsonify({"tehtavat": [_serialize_task_row(r) for r in rows]})
    except Exception:
        app.logger.exception("Aktiivisten tehtävien haku epäonnistui")
        return jsonify({"virhe": "Tehtävien haku epäonnistui"}), 500


@app.get("/api/aircrafts/<int:aircraft_id>/task-offers")
def task_offers(aircraft_id: int):
    """
    Generoi satunnaisia lentotehtävätarjouksia tietylle koneelle.
    
    Käyttää GameSession-luokan _random_task_offers_for_plane()-metodia, joka
    soveltaa pelilogiikkaa: tehtävän pituus, palkkio ja rangaistus lasketaan
    koneen kunnon, etäisyyden ja vaikeusasteen perusteella.
    
    Vastaus JSON-muodossa:
    {
        "aircraft": {"aircraft_id": 5, "registration": "OH-ABC", ...},
        "offers": [
            {"dest_ident": "EGLL", "dest_name": "London", "payload_kg": 1000, ...}
        ]
    }
    """
    plane = _fetch_plane(aircraft_id)
    if not plane:
        return jsonify({"virhe": "Koneen haku epäonnistui"}), 404

    try:
        session = GameSession(save_id=ACTIVE_SAVE_ID)
        offers = session._random_task_offers_for_plane(plane, count=DEFAULT_TASK_OFFER_COUNT)
    except Exception:
        app.logger.exception("Tarjousten generointi epäonnistui")
        return jsonify({"virhe": "Tarjousten muodostus epäonnistui"}), 500

    return jsonify(
        {
            "aircraft": {
                "aircraft_id": plane["aircraft_id"],
                "registration": plane["registration"],
                "status": plane["status"],
                "current_airport": plane["current_airport_ident"],
            },
            "offers": [_serialize_offer(o) for o in offers],
        }
    )


@app.post("/api/tasks")
def accept_task():
    """Hyväksyy tehtävän ja kirjaa sen tietokantaan.
    
    Tämä rajapinta käsittelee uuden lentotehtävän hyväksymisen. Se vastaanottaa
    tiedot koneesta ja tarjouksesta, luo niistä uuden sopimuksen ja lennon
    tietokantaan, ja asettaa koneen BUSY-tilaan. Lentotehtävän kestoa
    mukautetaan mahdollisten päiväkohtaisten satunnaistapahtumien mukaan.
    Kaikki tietokantatoiminnot suoritetaan transaktion sisällä atomisuuden
    varmistamiseksi.
    """
    payload = request.get_json(silent=True) or {}
    aircraft_id = payload.get("aircraft_id")
    offer = payload.get("offer") or {}

    # Tarkistetaan, että pakolliset tiedot (koneen ID ja tarjouskohde) ovat mukana pyynnössä.
    if not aircraft_id:
        return jsonify({"virhe": "aircraft_id on pakollinen"}), 400
    if not offer.get("dest_ident"):
        return jsonify({"virhe": "Tarjouksen kohde on pakollinen"}), 400

    # Purketaan tarjousdatasta tarvittavat arvot. Käytetään try-except-lohkoa
    # virheellisen tai puuttuvan datan varalta.
    try:
        dest_ident = offer["dest_ident"]
        payload_kg = int(offer["payload_kg"])
        reward = Decimal(str(offer["reward"]))
        penalty = Decimal(str(offer["penalty"]))
        deadline = int(offer["deadline"])
        total_days = int(offer["total_days"])
        distance_km = float(offer["distance_km"])
        trips = int(offer["trips"])
    except (ValueError, KeyError) as e:
        # Palautetaan virhe, jos tarjousdata on puutteellista tai vääränmuotoista.
        return jsonify({"virhe": f"Virheellinen tarjousdata: {e}"}), 400

    # Luodaan GameSession-olio käsillä olevaa tallennusta varten.
    session = GameSession(save_id=ACTIVE_SAVE_ID)
    
    # Haetaan koneen tiedot ja tarkistetaan, että se on olemassa ja IDLE-tilassa.
    # Vain IDLE-koneen voi lähettää uudelle tehtävälle.
    plane = _fetch_plane(aircraft_id)
    if not plane:
        return jsonify({"virhe": "Konetta ei löytynyt"}), 404
    if plane["status"] != "IDLE":
        return jsonify({"virhe": f"Koneen tila on {plane['status']}, ei voi aloittaa tehtävää"}), 409

    # Lasketaan lennon todellinen kesto ja saapumispäivä huomioiden mahdolliset satunnaiset tapahtumat.
    now_day = session.current_day
    base_total_days = total_days
    flight_days = base_total_days
    duration_factor = 1.0 # Oletuskerroin, jos tapahtumaa ei ole tai se ei vaikuta kestoon.
    departure_event_id = None
    
    # Jos tallennuksella on RNG-siemen asetettuna, haetaan päiväkohtainen lentotapahtuma.
    if session.rng_seed is not None:
        event_candidate = get_event_for_day(session.rng_seed, now_day, "flight", play_sound=False)
        if event_candidate is not None:
            departure_event_id = event_candidate.event_id
            try:
                raw_factor = float(event_candidate.days if event_candidate.days is not None else 1.0)
            except (TypeError, ValueError):
                raw_factor = 1.0
            if raw_factor <= 0: # Varmistetaan, ettei kerroin ole nolla tai negatiivinen.
                raw_factor = 1.0
            duration_factor = raw_factor
            
            # Mukautetaan lennon kestoa tapahtuman vaikutuksen mukaan. Pyöristys ylös tai alas
            # riippuen siitä, nopeuttaako vai hidastaako tapahtuma lentoa.
            if raw_factor < 1.0:
                flight_days = max(1, math.floor(base_total_days * raw_factor))
            elif raw_factor > 1.0:
                flight_days = math.ceil(base_total_days * raw_factor)

    arr_day = now_day + flight_days
    delay_minutes = int((flight_days - base_total_days) * 24 * 60) # Lasketaan viivästys minuuteissa.
    total_dist_all_trips = distance_km * trips # Kokonaismatka useamman reissun tapauksessa.

    # Avataan tietokantayhteys ja aloitetaan transaktio, jotta kaikki operaatiot ovat atomisia.
    yhteys = get_connection()
    try:
        yhteys.start_transaction()
        kursori = yhteys.cursor()

        # 1. Lisätään uusi sopimus 'contracts'-tauluun.
        kursori.execute(
            """
            INSERT INTO contracts (payload_kg, reward, penalty, priority,
                                   created_day, deadline_day, accepted_day, completed_day,
                                   status, lost_packages, damaged_packages,
                                   save_id, aircraft_id, ident, event_id)
            VALUES (%s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s)
            """,
            (
                payload_kg, reward, penalty, "NORMAL",
                now_day, deadline, now_day, None,
                "IN_PROGRESS", 0, 0,
                session.save_id, aircraft_id, dest_ident, departure_event_id # event_id talteen, jos tapahtuma oli.
            ),
        )
        contract_id = kursori.lastrowid # Haetaan juuri luodun sopimuksen ID.

        # 2. Lisätään uusi lento 'flights'-tauluun, linkitettynä edellä luotuun sopimukseen.
        kursori.execute(
            """
            INSERT INTO flights (created_day, dep_day, arrival_day, status, distance_km, schedule_delay_min,
                                 emission_kg_co2, eco_fee, dep_ident, arr_ident, aircraft_id, save_id,
                                 contract_id)
            VALUES (%s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                now_day, now_day, arr_day, "ENROUTE", total_dist_all_trips, delay_minutes,
                0.0, Decimal("0.00"), plane["current_airport_ident"], dest_ident,
                aircraft_id, session.save_id, contract_id
            ),
        )

        # 3. Päivitetään lentokoneen tila 'BUSY'-tilaan, jotta se on varattu tälle lennolle.
        kursori.execute(
            "UPDATE aircraft SET status = 'BUSY' WHERE aircraft_id = %s",
            (aircraft_id,)
        )

        # 4. Kirjataan tapahtuma 'save_event_log'-tauluun. Käytetään suoraa SQL-INSERTiä,
        # jotta lokimerkintä pysyy samassa transaktiossa ja on atominen muiden muutosten kanssa.
        log_payload = f"contract_id={contract_id}; dest={dest_ident}; payload={payload_kg}; eta_day={arr_day}"
        kursori.execute(
            "INSERT INTO save_event_log (save_id, event_day, event_type, payload, created_at) VALUES (%s, %s, %s, %s, %s)",
            (session.save_id, now_day, "CONTRACT_STARTED", log_payload, datetime.utcnow())
        )

        yhteys.commit() # Vahvistetaan kaikki transaktiossa tehdyt muutokset tietokantaan.
        
        # Palautetaan onnistunut vastaus JSON-muodossa, sisältäen keskeiset tiedot.
        return jsonify({
            "status": "ok",
            "contract_id": contract_id,
            "aircraft_id": aircraft_id,
            "destination": dest_ident,
            "arrival_day": arr_day,
            "reward": _decimal_to_string(reward) # Muunnetaan Decimal merkkijonoksi JSONia varten.
        }), 201

    except Exception as e:
        yhteys.rollback() # Perutaan kaikki transaktiossa tehdyt muutokset, jos virhe ilmenee.
        app.logger.exception("Tehtävän luonti epäonnistui")
        return jsonify({"virhe": "Tehtävän luonti epäonnistui", "detail": str(e)}), 500
    finally:
        # Suljetaan tietokantayhteys ja kursori aina lopuksi resurssien vapauttamiseksi.
        try:
            kursori.close()
            yhteys.close()
        except Exception:
            pass


# ---------- Reitit: Kauppapaikka ----------
# [KEHITTÄJÄ 4]
# Kauppapaikka-endpointit hallitsevat koneiden ostamista uusien ja käytettyjen
# markkinoilta. Uudet koneet suodatetaan pelaajan tukikohdan tason (SMALL..HUGE)
# perusteella, mikä soveltaa GameSession-metodia _fetch_aircraft_models_by_base_progress().
# Käytetyt koneet tulevat market_aircraft-taulusta ja päivittyvät joka kerta
# kun pelaaja avaa markkinat (vanhat koneet poistetaan automaattisesti).

@app.get("/api/market/new")
def market_new():
    """
    [KEHITTÄJÄ 4] Listaa myynnissä olevat uudet konemallit.
    
    Suodatetaan pelaajan korkeimman tukikohdan tason mukaan. GameSession-luokan
    _fetch_aircraft_models_by_base_progress()-metodi hakee kaikki konemallit, joiden
    kategoria on <= pelaajan tukikohdan maksimitaso.
    
    Esim:
    - Tukikohta SMALL-tasolla → näkyy SMALL-kategorian koneet
    - Tukikohta MEDIUM-tasolla → näkyy SMALL + MEDIUM-kategorian koneet
    - Tukikohta LARGE-tasolla → näkyy SMALL + MEDIUM + LARGE-kategorian koneet
    - Tukikohta HUGE-tasolla → näkyy kaikki kategoriat
    
    Vastaus JSON-muodossa:
    { "uudet_koneet": [{ "model_code": "C-172", "manufacturer": "Cessna", ... }] }
    """
    try:
        # Ladataan aktiivisen pelaajan sessio
        session = GameSession.load(ACTIVE_SAVE_ID)
        
        # Käytetään GameSessionin omaa metodia, joka suodattaa koneet tukikohdan tason mukaan
        rows = session._fetch_aircraft_models_by_base_progress()
        
        # Lisätään oleellisia kenttiä (API-vaatimukset)
        result_rows = []
        for row in rows:
            result_rows.append({
                "model_code": row.get("model_code"),
                "manufacturer": row.get("manufacturer"),
                "model_name": row.get("model_name"),
                "purchase_price": _decimal_to_string(row.get("purchase_price")),
                "base_cargo_kg": row.get("base_cargo_kg"),
                "cruise_speed_kts": row.get("cruise_speed_kts"),
                "range_km": row.get("range_km"),
                "category": row.get("category"),
            })
        
        return jsonify({"uudet_koneet": result_rows})
    except Exception:
        app.logger.exception("Uusien koneiden haku epäonnistui")
        return jsonify({"virhe": "Uusien koneiden haku epäonnistui"}), 500


@app.get("/api/market/used")
def market_used():
    """
    [KEHITTÄJÄ 4] Listaa käytettyjen koneiden markkinapaikan.
    
    Hakee kaikki aktiiviset ilmoitukset market_aircraft-taulusta ja yhdistää
    aircraft_models-tauluun konemallin tietojen (mallin nimi, kapasiteetti jne.) saamiseksi.
    Koneet lajitellaan listäyspäivän ja tunuksen mukaan (uusimmat ensin).
    
    Huom: GameSession._refresh_market_aircraft() poistaa yli 10 päivää vanhat
    ilmoitukset ja lisää uusia jokaisen markkinakäynnin.
    
    Vastaus JSON-muodossa:
    { "kaytetyt_koneet": [{ "market_id": 1, "model_code": "DC-3", "condition_percent": 85, ... }] }
    """
    try:
        rows = _query_dicts(
            """
            SELECT m.market_id,
                   m.model_code,
                   am.model_name,
                   am.base_cargo_kg,
                   am.cruise_speed_kts,
                   m.purchase_price,
                   m.condition_percent,
                   m.hours_flown,
                   m.listed_day,
                   m.manufactured_day,
                   m.market_notes,
                   (m.condition_percent > 0) as available
            FROM market_aircraft m
                     JOIN aircraft_models am ON am.model_code = m.model_code
            WHERE am.category != 'STARTER'
            ORDER BY m.listed_day DESC, m.market_id DESC
            LIMIT 25
            """,
        )
        for row in rows:
            row["purchase_price"] = _decimal_to_string(row.get("purchase_price"))
            # Laske ikä vuosina (oletus: nykyinen peli-päivä on 1, valmistuspäivä siitä taaksepäin)
            # Yleensä manufactured_day on negatiivinen luku tai 0
            manufactured_day = row.get("manufactured_day") or 0
            current_day = 1  # Oletuksena peli alkaa päivällä 1
            age_days = max(0, current_day - manufactured_day)
            row["age_years"] = max(1, age_days // 365) if age_days < 365 else age_days // 365
            row["notes"] = row.get("market_notes") or "Regular condition"
        return jsonify({"kaytetyt_koneet": rows})
    except Exception:
        app.logger.exception("Käytettyjen koneiden haku epäonnistui")
        return jsonify({"virhe": "Käytettyjen koneiden haku epäonnistui"}), 500


@app.post("/api/market/buy")
def market_buy():
    """Ostaa koneen (uusi tai käytetty).
    
    Tämä rajapinta käsittelee lentokoneiden ostoa joko uudelta tai käytetyltä
    markkinoilta. Se tarkistaa ostotyypin ('new' tai 'used'), hakee tarvittavat
    tiedot koneesta ja kutsuu GameSession-luokan osto-transaktiometodeja.
    Koneen osto päivittää pelaajan kassaa ja lisää koneen laivastoon.
    """
    payload = request.get_json(silent=True) or {}
    purchase_type = (payload.get("type") or "").lower()
    
    # Tarkistetaan, että ostotyyppi on kelvollinen.
    if purchase_type not in {"new", "used"}:
        return jsonify({"virhe": "type tulee olla 'new' tai 'used'"}), 400

    # Luodaan GameSession-olio käsillä olevaa tallennusta varten.
    session = GameSession(save_id=ACTIVE_SAVE_ID)
    
    # Määrätään koneen sijoituspaikka. Oletuksena pääkenttä, mutta voidaan antaa myös payloadissa.
    target_ident = payload.get("airport_ident") or session._get_primary_base_ident() or "EFHK"
    # Haetaan tukikohdan ID ICAO-tunnuksen perusteella; tarvitaan tietokantaviitteeksi.
    target_base_id = session._get_base_id_by_ident(target_ident)

    # --- UUDEN KONEEN OSTAMINEN ---
    if purchase_type == "new":
        model_code = payload.get("model_code")
        if not model_code:
            return jsonify({"virhe": "model_code puuttuu"}), 400
        
        # Haetaan konemallin tiedot tietokannasta, erityisesti hinta.
        model = _fetch_one_dict("SELECT * FROM aircraft_models WHERE model_code=%s", (model_code,))
        if not model:
            return jsonify({"virhe": "Tuntematon konemalli"}), 404
        
        price = Decimal(str(model["purchase_price"]))
        # Jos rekisteriä ei anneta, generoidaan se.
        registration = payload.get("registration") or session._generate_registration()
        nickname = payload.get("nickname")

        # Tarkistetaan, onko pelaajalla tarpeeksi rahaa.
        if session.cash < price:
             return jsonify({"virhe": "Rahat eivät riitä", "needed": _decimal_to_string(price), "has": _decimal_to_string(session.cash)}), 402

        # Kutsutaan GameSessionin transaktiometodia uuden koneen ostamiseen.
        # Tämä hoitaa rahaliikenteen ja koneen lisäämisen laivastoon atomisesti.
        success = session._purchase_aircraft_tx(
            model_code=model_code,
            current_airport_ident=target_ident,
            registration=registration,
            nickname=nickname,
            purchase_price=price,
            base_id=target_base_id
        )
        
        if success:
            return jsonify({"status": "ok", "registration": registration, "price": _decimal_to_string(price)}), 200
        else:
            # Jos osto epäonnistuu, se johtuu yleensä tietokantavirheestä tai samanaikaisesta kassamuutoksesta.
            return jsonify({"virhe": "Osto epäonnistui (tietokantavirhe tai saldo muuttui)"}), 500

    # --- KÄYTETYN KONEEN OSTAMINEN ---
    elif purchase_type == "used":
        market_id = payload.get("market_id")
        if not market_id:
             return jsonify({"virhe": "market_id puuttuu"}), 400
        
        # Haetaan käytetyn markkinakoneen tiedot tietokannasta.
        market_plane = _fetch_one_dict("SELECT * FROM market_aircraft WHERE market_id=%s", (market_id,))
        if not market_plane:
             # Jos konetta ei löydy, se on todennäköisesti myyty jo.
             return jsonify({"virhe": "Kone ei ole enää myynnissä"}), 404

        # Kutsutaan GameSessionin transaktiometodia käytetyn koneen ostamiseen.
        # Metodi hoitaa itse rahatarkistuksen, koneen siirron ja markkinalistauksen poiston.
        success = session._purchase_market_aircraft_tx(market_plane)
        
        if success:
             return jsonify({"status": "ok", "market_id": market_id}), 200
        else:
             # Epäonnistuminen voi johtua riittämättömästä saldosta tai siitä, että toinen käyttäjä
             # osti koneen juuri.
             return jsonify({"virhe": "Osto epäonnistui (rahat eivät riitä tai joku muu ehti ensin)"}), 409

    return jsonify({"virhe": "Tuntematon virhe"}), 500


# ---------- Reitit: Kerhohuone ----------
# [KEHITTÄJÄ 4]
# Kerhohuone on salainen minipelien paikka, jossa pelaaja voi vetää pukuja pelikassallaan.
# Minipelit: Coin Flip (kruuna/klaava), High/Low (noppapeli) ja Slots (yksikätinen rosvo).
# Kaikki pelit päivittävät GameSessionin kassaa (_add_cash-metodin kautta).

@app.get("/api/clubhouse")
def clubhouse_info():
    """
    [KEHITTÄJÄ 4] Palauttaa saatavilla olevat minipelit.
    
    Vastaus JSON-muodossa:
    {
        "pelit": [
            {"nimi": "coin_flip", "kuvaus": "Tupla tai kuitti kolikolla"},
            {"nimi": "high_low", "kuvaus": "Arvaa nopan tulos"},
            {"nimi": "slots", "kuvaus": "Yksikätinen rosvo"}
        ]
    }
    """
    games = [
        {"nimi": "coin_flip", "kuvaus": "Tupla tai kuitti kolikolla"},
        {"nimi": "fuel_quiz", "kuvaus": "Arvaa paljonko tankki vetää"},
    ]
    return jsonify({"pelit": games})


@app.post("/api/clubhouse")
def clubhouse_play():
    """
    Pelaa minipeliä (coin_flip, high_low, slots) ja päivitä kassaa.
    
    Tämä rajapinta käsittelee kerhohuoneen minipelien pelaamisesta. Se vastaanottaa
    pelin tyypin (coin_flip, high_low, slots), panoksen ja valinnat, simuloi peliä,
    ja päivittää pelaajan kassaa voittojen tai tappioiden mukaan.
    
    HUOM: RNG nollataan järjestelmän ajalla, koska minipelit eivät saisi olla
    determinististisiä (toisin kuin lentotehtävät jotka käyttävät seed-arvoa).
    
    Pyyntö JSON-muodossa:
    { "game": "coin_flip", "bet": 1000, "choice": "heads" }
    
    Vastaus JSON-muodossa:
    { "game": "coin_flip", "flip": "heads", "voitto": true, "viesti": "Voitit 1000 euroa!" }
    """
    payload = request.get_json(silent=True) or {}
    peli = payload.get("game")
    
    valid_games = {"coin_flip", "high_low", "slots"}
    if peli not in valid_games:
        return jsonify({"virhe": f"Peliä ei tueta. Vaihtoehdot: {', '.join(valid_games)}"}), 400

    # 1. Panoksen validointi
    try:
        bet = Decimal(str(payload.get("bet") or 0))
    except Exception:
        return jsonify({"virhe": "Virheellinen panos"}), 400

    if bet <= 0:
        return jsonify({"virhe": "Panoksen pitää olla positiivinen"}), 400

    session = GameSession(save_id=ACTIVE_SAVE_ID)
    
    # KERHOHUONE-FIX: 
    # GameSession nollaa satunnaislukugeneraattorin (RNG) aina samaksi, jos tallennuksessa on seed.
    # Minipelien halutaan kuitenkin olevan satunnaisia joka kerta.
    # Nollataan RNG käyttämään järjestelmän aikaa.
    random.seed()

    if session.cash < bet:
        return jsonify({"virhe": "Rahat eivät riitä"}), 402

    response_data = {}
    
    # --- COIN FLIP ---
    if peli == "coin_flip":
        choice = (payload.get("choice") or "heads").lower()
        flip = random.choice(["heads", "tails"])
        win = choice == flip
        
        amount_change = bet if win else -bet
        context = "CLUB_COIN_WIN" if win else "CLUB_COIN_LOSS"
        
        session._add_cash(amount_change, context=context)
        
        message = f"Voitit {bet} euroa!" if win else f"Hävisit {bet} euroa."
        response_data = {
            "game": "coin_flip",
            "flip": flip,
            "voitto": win,
            "viesti": message
        }

    # --- HIGH / LOW (Noppapeli) ---
    elif peli == "high_low":
        # Logiikka: Arvotaan noppa 1 ja noppa 2. Pelaaja arvaa onko n2 suurempi vai pienempi kuin n1.
        # Huom: Web-versiossa tämä on "sokea" arvaus verrattuna CLI-versioon, jossa näkee ekan nopan.
        # Jotta peli olisi reilumpi webissä, palautamme nopat ja tuloksen kerralla.
        
        valinta = (payload.get("choice") or "high").lower() # 'high' (suurempi) tai 'low' (pienempi)
        # Mapping frontin termeistä backendin logiikkaan (s=suurempi, p=pienempi)
        logic_choice = "s" if valinta in ["high", "higher", "s"] else "p"
        
        noppa1 = random.randint(1, 6)
        noppa2 = random.randint(1, 6)
        
        # Logiikka game_session.py:stä
        tulos_oikein = (logic_choice == "s" and noppa2 > noppa1) or \
                       (logic_choice == "p" and noppa2 < noppa1)
        
        is_push = (noppa1 == noppa2)
        
        if is_push:
            # Tasapeli: Talo voittaa
            session._add_cash(-bet, context="CLUB_HILO_PUSH")
            message = f"Tasapeli ({noppa1}-{noppa2})! Talo voittaa."
            win = False
        elif tulos_oikein:
            session._add_cash(bet, context="CLUB_HILO_WIN")
            message = f"Oikein ({noppa1} vs {noppa2})! Voitit {bet} euroa."
            win = True
        else:
            session._add_cash(-bet, context="CLUB_HILO_LOSS")
            message = f"Väärin ({noppa1} vs {noppa2}). Hävisit {bet} euroa."
            win = False
            
        response_data = {
            "game": "high_low",
            "dice1": noppa1,
            "dice2": noppa2,
            "voitto": win,
            "push": is_push,
            "viesti": message
        }

    # --- SLOTS (Yksikätinen rosvo) ---
    elif peli == "slots":
        # Veloitetaan panos heti
        session._add_cash(-bet, context="CLUB_SLOT_BET")
        
        symbols = ['🍒', '🍋', '🔔', '💎', '💰']
        weights = [40, 30, 20, 9, 1]
        reels = random.choices(symbols, weights=weights, k=3)
        
        win_multiplier = Decimal("0")
        
        # Voittologiikka game_session.py:stä
        if reels[0] == '💰' and reels[1] == '💰' and reels[2] == '💰':
            win_multiplier = Decimal("50")
        elif reels[0] == '💎' and reels[1] == '💎' and reels[2] == '💎':
            win_multiplier = Decimal("20")
        elif reels[0] == '🔔' and reels[1] == '🔔' and reels[2] == '🔔':
            win_multiplier = Decimal("10")
        elif reels[0] == '🍋' and reels[1] == '🍋' and reels[2] == '🍋':
            win_multiplier = Decimal("5")
        elif reels[0] == '🍒' and reels[1] == '🍒' and reels[2] == '🍒':
            win_multiplier = Decimal("3")
        elif reels[0] == '🍒' and reels[1] == '🍒':
            win_multiplier = Decimal("2")
            
        win_amount = bet * win_multiplier
        
        if win_amount > 0:
            session._add_cash(win_amount, context="CLUB_SLOT_WIN")
            message = f"Voitto! {reels[0]} {reels[1]} {reels[2]} -> {win_amount} €"
            win = True
        else:
            message = f"Ei voittoa. {reels[0]} {reels[1]} {reels[2]}"
            win = False
            
        response_data = {
            "game": "slots",
            "reels": reels,
            "voitto": win,
            "win_amount": _decimal_to_string(win_amount),
            "viesti": message
        }

    # Lisätään vastauspakettiin aina päivitetty saldo
    response_data["balance"] = _decimal_to_string(session.cash)
    
    return jsonify(response_data)

# ---------- Reitit: Lentokoneet ja tukikohdat ----------
@app.get("/api/aircrafts")
def api_list_aircrafts():
    """Omistettujen lentokoneiden lista (ACTIVE_SAVE_ID:stä)."""
    try:
        rows = fetch_player_aircrafts_with_model_info(ACTIVE_SAVE_ID) or []
    except Exception:
        app.logger.exception("fetch_player_aircrafts_with_model_info epäonnistui")
        return jsonify({"virhe": "aircrafts fetch failed"}), 500

    session = GameSession(save_id=ACTIVE_SAVE_ID)
    ids = [int(r["aircraft_id"]) for r in rows]
    try:
        upgrade_map = session._fetch_upgrade_levels(ids) if ids else {}
    except Exception:
        upgrade_map = {}

    out = []
    for r in rows:
        aid = int(r["aircraft_id"])
        try:
            eff_val = get_effective_eco_for_aircraft(aid)
            eff = _decimal_to_string(Decimal(str(eff_val))) if eff_val is not None else None
        except Exception:
            eff = None
        out.append(
            {
                "aircraft_id": aid,
                "registration": r.get("registration"),
                "model_code": r.get("model_code"),
                "model_name": r.get("model_name"),
                "current_airport_ident": r.get("current_airport_ident"),
                "purchase_price": _decimal_to_string(r.get("purchase_price")),
                "condition_percent": int(r.get("condition_percent") or 0),
                "hours_flown": int(r.get("hours_flown") or 0),
                "status": r.get("status"),
                "acquired_day": int(r.get("acquired_day") or 0),
                "eco_level": int(upgrade_map.get(aid, 0)),
                "effective_eco": eff,
            }
        )
    return jsonify({"save_id": ACTIVE_SAVE_ID, "aircrafts": out})


@app.get("/api/aircrafts/<int:aircraft_id>")
def api_get_aircraft(aircraft_id: int):
    """Tarkemmat tiedot yhdestä lentokoneesta."""
    rows = fetch_player_aircrafts_with_model_info(ACTIVE_SAVE_ID) or []
    row = next((r for r in rows if int(r["aircraft_id"]) == aircraft_id), None)
    if not row:
        return jsonify({"virhe": "aircraft not found"}), 404

    state = get_current_aircraft_upgrade_state(aircraft_id) or {"level": 0}
    cur_level = int(state.get("level") or 0)
    next_level = cur_level + 1

    try:
        next_cost = calc_aircraft_upgrade_cost(row, next_level)
    except Exception:
        next_cost = None

    try:
        cur_eff_val = get_effective_eco_for_aircraft(aircraft_id)
        cur_eff = _decimal_to_string(Decimal(str(cur_eff_val))) if cur_eff_val is not None else None
    except Exception:
        cur_eff = None

    # Konservatiivinen arvio seuraavasta ECO-arvosta
    next_eff = None
    try:
        if cur_eff is not None:
            next_eff = _decimal_to_string(Decimal(cur_eff) * Decimal("1.05"))
    except Exception:
        next_eff = None

    return jsonify(
        {
            "aircraft_id": aircraft_id,
            "registration": row.get("registration"),
            "model_code": row.get("model_code"),
            "model_name": row.get("model_name"),
            "current_airport_ident": row.get("current_airport_ident"),
            "condition_percent": int(row.get("condition_percent") or 0),
            "hours_flown": int(row.get("hours_flown") or 0),
            "status": row.get("status"),
            "acquired_day": int(row.get("acquired_day") or 0),
            "eco": {
                "current_level": cur_level,
                "next_level": next_level,
                "current_effective_eco": cur_eff,
                "next_effective_eco_estimate": next_eff,
                "next_upgrade_cost": _decimal_to_string(next_cost),
            },
        }
    )


@app.post("/api/aircrafts/<int:aircraft_id>/repair")
def api_repair_aircraft(aircraft_id: int):
    """Korjaa lentokoneen täydelliseksi (transaktiona GameSessionin kautta)."""
    # Arvio kustannuksesta (parhaan yrityksen mukaan)
    row = _fetch_one_dict(
        "SELECT condition_percent FROM aircraft WHERE aircraft_id=%s AND save_id=%s",
        (aircraft_id, ACTIVE_SAVE_ID),
    )
    if not row:
        return jsonify({"virhe": "aircraft not found"}), 404
    cond = int(row.get("condition_percent") or 0)
    missing = max(0, 100 - cond)
    est_cost = (Decimal(missing) * REPAIR_COST_PER_PERCENT).quantize(Decimal("0.01"))

    session = GameSession(save_id=ACTIVE_SAVE_ID)
    try:
        ok = session._repair_aircraft_to_full_tx(aircraft_id)
    except Exception as e:
        app.logger.exception("repair failed")
        return jsonify({"virhe": "repair_failed", "detail": str(e)}), 500

    if not ok:
        return jsonify({"virhe": "repair failed (insufficient funds / busy)"}), 409

    return (
        jsonify(
            {
                "status": "ok",
                "aircraft_id": aircraft_id,
                "cost_charged": _decimal_to_string(est_cost),
                "remaining_cash": _decimal_to_string(session.cash),
            }
        ),
        200,
    )


@app.post("/api/aircrafts/<int:aircraft_id>/upgrade")
def api_upgrade_aircraft(aircraft_id: int):
    """ECO-päivitys lentokoneelle."""
    payload = request.get_json(silent=True) or {}
    if not payload.get("confirm"):
        return jsonify({"virhe": "confirm required"}), 400

    rows = fetch_player_aircrafts_with_model_info(ACTIVE_SAVE_ID) or []
    row = next((r for r in rows if int(r["aircraft_id"]) == aircraft_id), None)
    if not row:
        return jsonify({"virhe": "aircraft not found"}), 404

    state = get_current_aircraft_upgrade_state(aircraft_id) or {"level": 0}
    cur_level = int(state.get("level") or 0)
    next_level = cur_level + 1

    try:
        cost = calc_aircraft_upgrade_cost(row, next_level)
    except Exception as e:
        app.logger.exception("calc cost failed")
        return jsonify({"virhe": "cost_calculation_failed", "detail": str(e)}), 500

    session = GameSession(save_id=ACTIVE_SAVE_ID)
    if session.cash < Decimal(str(cost)):
        return jsonify({"virhe": "insufficient_funds"}), 402

    try:
        apply_aircraft_upgrade(aircraft_id=aircraft_id, installed_day=session.current_day)
        session._add_cash(-Decimal(str(cost)), context="AIRCRAFT_ECO_UPGRADE")
    except Exception as e:
        app.logger.exception("upgrade failed")
        return jsonify({"virhe": "upgrade_failed", "detail": str(e)}), 500

    return (
        jsonify(
            {
                "status": "ok",
                "aircraft_id": aircraft_id,
                "new_level": next_level,
                "cost": _decimal_to_string(cost),
                "remaining_cash": _decimal_to_string(session.cash),
            }
        ),
        200,
    )


@app.get("/api/bases")
def api_list_bases():
    """Lista pelaajan omistamista tukikohdista."""
    try:
        bases = fetch_owned_bases(ACTIVE_SAVE_ID) or []
    except Exception:
        app.logger.exception("fetch_owned_bases epäonnistui")
        return jsonify({"virhe": "bases fetch failed"}), 500

    base_ids = [int(b["base_id"]) for b in bases]
    level_map = fetch_base_current_level_map(base_ids) if base_ids else {}

    out = []
    for b in bases:
        out.append(
            {
                "base_id": int(b["base_id"]),
                "base_ident": b.get("base_ident"),
                "base_name": b.get("base_name"),
                "acquired_day": int(b.get("acquired_day") or 0),
                "purchase_cost": _decimal_to_string(b.get("purchase_cost")),
                "current_level": level_map.get(int(b["base_id"]), "SMALL"),
            }
        )
    return jsonify({"owned_bases": out})


@app.post("/api/bases/<int:base_id>/upgrade")
def api_upgrade_base(base_id: int):
    """Tukikohdan päivitys seuraavalle tasolle."""
    payload = request.get_json(silent=True) or {}
    if not payload.get("confirm"):
        return jsonify({"virhe": "confirm required"}), 400

    bases = fetch_owned_bases(ACTIVE_SAVE_ID) or []
    b = next((x for x in bases if int(x["base_id"]) == base_id), None)
    if not b:
        return jsonify({"virhe": "base not owned"}), 404

    lvl_map = fetch_base_current_level_map([base_id]) or {}
    current = lvl_map.get(base_id, "SMALL")
    BASE_LEVELS = ["SMALL", "MEDIUM", "LARGE", "HUGE"]
    BASE_UPGRADE_COST_PCTS = {
        ("SMALL", "MEDIUM"): Decimal("0.50"),
        ("MEDIUM", "LARGE"): Decimal("0.90"),
        ("LARGE", "HUGE"): Decimal("1.50"),
    }
    try:
        cur_idx = BASE_LEVELS.index(current)
    except ValueError:
        cur_idx = 0
    if cur_idx >= len(BASE_LEVELS) - 1:
        return jsonify({"virhe": "already_max"}), 400

    nxt = BASE_LEVELS[cur_idx + 1]
    pct = BASE_UPGRADE_COST_PCTS[(current, nxt)]
    cost = (Decimal(str(b.get("purchase_cost") or "0")) * pct).quantize(Decimal("0.01"))

    session = GameSession(save_id=ACTIVE_SAVE_ID)
    if session.cash < cost:
        return jsonify({"virhe": "insufficient_funds"}), 402

    try:
        insert_base_upgrade(base_id, nxt, cost, session.current_day)
        session._add_cash(-cost, context="BASE_UPGRADE")
    except Exception as e:
        app.logger.exception("base upgrade failed")
        return jsonify({"virhe": "upgrade_failed", "detail": str(e)}), 500

    return (
        jsonify(
            {
                "status": "ok",
                "base_id": base_id,
                "from": current,
                "to": nxt,
                "cost": _decimal_to_string(cost),
                "remaining_cash": _decimal_to_string(session.cash),
            }
        ),
        200,
    )


# ---------- Reitit: Kartta-näkymä ----------

@app.get("/api/map-data")
def get_map_data():
    """
    Hakee kartta-näkymää varten kaikki oleelliset tiedot:
    - Aktiiviset sopimukset ja niiden pohjat
    - Lentokoneiden sijainnit (lähtö ja määrä)
    - Lentokenttien koordinaatit
    - Edistymisprosentti kunkin lennon osalta
    """
    session = GameSession(ACTIVE_SAVE_ID)
    
    yhteys = get_connection()
    kursori = None
    try:
        kursori = yhteys.cursor(dictionary=True)
        
        # Haetaan kaikki aktiiviset sopimukset (hyväksytyt tai käynnissä)
        cond_sql = """
            SELECT 
                c.contractId,
                f.dep_day as start_day,
                c.deadline_day,
                c.reward,
                c.status,
                a.current_airport_ident as origin_ident,
                o1.latitude_deg as origin_lat,
                o1.longitude_deg as origin_lon,
                o1.name as origin_name,
                c.ident as dest_ident,
                o2.latitude_deg as dest_lat,
                o2.longitude_deg as dest_lon,
                o2.name as dest_name,
                a.registration,
                f.arrival_day,
                f.schedule_delay_min,
                c.event_id
            FROM contracts c
            JOIN aircraft a ON c.aircraft_id = a.aircraft_id
            JOIN airport o1 ON a.current_airport_ident = o1.ident
            JOIN airport o2 ON c.ident = o2.ident
            JOIN flights f ON c.contractId = f.contract_id
            WHERE c.status IN ('ACCEPTED', 'IN_PROGRESS')
            ORDER BY c.contractId
        """
        kursori.execute(cond_sql)
        contracts = kursori.fetchall() or []
        
        # Haetaan kaikki lentokentät koordinaatteineen (kartanäytölle)
        airport_sql = """
            SELECT ident, name, latitude_deg, longitude_deg
            FROM airport
            ORDER BY ident
        """
        kursori.execute(airport_sql)
        all_airports = kursori.fetchall() or []
        
        # Rakennetaan vastaus
        map_contracts = []
        seen_airports = set()
        
        current_day = session.current_day or 1
        
        for contract in contracts:
            origin_id = contract.get("origin_ident")
            dest_id = contract.get("dest_ident")
            
            # Merkitään lentokentät nähtyiksi
            seen_airports.add(origin_id)
            seen_airports.add(dest_id)
            
            # Lasketaan edistymisprosentti
            start_day = contract.get("pay_day", current_day)
            end_day = contract.get("arrival_day", contract.get("deadline_day", current_day + 1))
            progress_pct = 0
            if end_day > start_day:
                progress_pct = min(100, max(0, int(100.0 * (current_day - start_day) / (end_day - start_day))))
            
            map_contracts.append({
                "contractId": contract.get("contract_id"),
                "aircraft": contract.get("registration"),
                "originIdent": origin_id,
                "originLat": float(contract.get("origin_lat", 0)),
                "originLon": float(contract.get("origin_lon", 0)),
                "originName": contract.get("origin_name", ""),
                "destIdent": dest_id,
                "destLat": float(contract.get("dest_lat", 0)),
                "destLon": float(contract.get("dest_lon", 0)),
                "destName": contract.get("dest_name", ""),
                "status": contract.get("status", "IN_PROGRESS"),
                "startDay": start_day,
                "currentDay": current_day,
                "estimatedDay": end_day,
                "progressPercent": progress_pct,
                "reward": _decimal_to_string(contract.get("reward")),
            })
        
        # Haetaan omien kantojen ICAO-koodit ja pääkotisatama
        bases_sql = "SELECT base_ident, is_headquarters FROM owned_bases WHERE save_id = %s"
        kursori.execute(bases_sql, (ACTIVE_SAVE_ID,))
        owned_bases_rows = kursori.fetchall() or []
        owned_bases = set(row.get("base_ident") for row in owned_bases_rows)
        headquarters_ident = None
        for row in owned_bases_rows:
            if row.get("is_headquarters"):
                headquarters_ident = row.get("base_ident")
                break
        
        # Rakennetaan lentokenttälista
        all_airports_list = []
        for airport in all_airports:
            ident = airport.get("ident")
            all_airports_list.append({
                "ident": ident,
                "name": airport.get("name", ""),
                "latitude_deg": float(airport.get("latitude_deg", 0)),
                "longitude_deg": float(airport.get("longitude_deg", 0)),
            })
        
        return jsonify({
            "currentDay": current_day,
            "activeContracts": map_contracts,
            "airports": all_airports_list,
            "headquartersIdent": headquarters_ident,
        }), 200
        
    except Exception as e:
        return jsonify({"virhe": f"Kartatietojen haku epäonnistui: {str(e)}"}), 500
    finally:
        if kursori is not None:
            try:
                kursori.close()
            except Exception:
                pass
        yhteys.close()



# ---------- Staattiset tiedostot (Frontend) ----------

@app.route('/')
def serve_index():
    """Palauttaa pääsivun (index.html)"""
    try:
        return send_from_directory(app.static_folder, 'index.html')
    except Exception as e:
        app.logger.error(f"Error serving index.html: {e}")
        # Varasuunnitelma: lue tiedosto suoraan
        import os
        if app.static_folder:
            path = os.path.join(app.static_folder, 'index.html')
            if os.path.exists(path):
                with open(path, 'r', encoding='utf-8') as f:
                    return f.read()
        return "index.html not found", 404


@app.route('/<path:path>')
def serve_static(path):
    """Palauttaa staattiset tiedostot (CSS, JS)"""
    return send_from_directory(app.static_folder, path)

if __name__ == "__main__":
    # Kehityskäyttöön sopiva debug-palvelin.
    # Huom: Portti 5000 on varattu AirTunesille macOS:lla, käytä 5001 sen sijaan
    app.run(debug=True, port=5001)
