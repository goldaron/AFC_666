"""Flask-pohjainen rajapinta"""

import os
import random
from decimal import Decimal
from typing import Any, Dict, List, Optional

from flask import Flask, jsonify, request, send_from_directory

from game_session import GameSession
from utils import get_connection
from session_helpers.common import _to_dec
from upgrade_config import SURVIVAL_TARGET_DAYS

ACTIVE_GAME_SESSION: GameSession = None
app = Flask(__name__, static_folder='static')
# Tämä kertoo minkä tallennuksen tietoja API lukee; oletuksena käytetään slot 1:tä.
ACTIVE_SAVE_ID = int(os.environ.get("AFC_ACTIVE_SAVE_ID", 1))
# Näin monta tarjousta pyydetään kerralla GameSessionilta.
DEFAULT_TASK_OFFER_COUNT = 5

#Lentokoneita varten funktiot
from session_helpers import (
    fetch_player_aircrafts_with_model_info,
    get_current_aircraft_upgrade_state,
    calc_aircraft_upgrade_cost,
    apply_aircraft_upgrade,
    get_effective_eco_for_aircraft,
    fetch_owned_bases,
    fetch_base_current_level_map,
    insert_base_upgrade,
    get_base_capacity_info,  # ADD THIS
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

def _get_recent_events(limit: int = 10) -> List[Dict[str, Any]]:
    """Hakee viimeisimmät pelitapahtumat."""
    return _query_dicts(
        """
        SELECT log_id, event_day, event_type, payload, created_at
        FROM save_event_log
        WHERE save_id = %s
        ORDER BY log_id DESC
        LIMIT %s
        """,
        (ACTIVE_SAVE_ID, limit),
    )

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

def _list_all_saves() -> List[Dict[str, Any]]:
    """Hakee listan tallennetuista peleistä game_saves-taulusta."""
    return _query_dicts(
        """
        SELECT save_id, player_name, current_day, cash, difficulty, status, created_at, updated_at
        FROM game_saves
        ORDER BY created_at DESC
        """
    )

# ---------- Reitit: Elinkaari ----------

@app.post("/api/games")
def create_game():
    """Luo uuden tallennuksen ja palauttaa sen ID:n."""
    payload = request.get_json(silent=True) or {}
    player_name = payload.get("player_name")
    rng_seed = payload.get("rng_seed")
    difficulty = payload.get("difficulty", "NORMAL")

    if not player_name:
        return jsonify({"Virhe": "Pelaajan nimi on pakollinen."})

    try:
        session = GameSession.new_game(
            name= player_name,
            rng_seed= int(rng_seed) if rng_seed else None,
            default_difficulty=difficulty
        )
        new_save_id = session.save_id

        # Aseta uusi peli aktiiviseksi
        global ACTIVE_SAVE_ID
        ACTIVE_SAVE_ID = new_save_id

        return jsonify({
        "Viesti": "Uusi peli luotu",
        "save_id": new_save_id,
        "status": session.status,
        "current_day": session.current_day,
        "cash": session.cash,
        }), 201

    except Exception as e:
        app.logger.exception("Pelin luonti epäonnistui")
        return jsonify({"Virhe": f"Pelin luonti epäonnistui: str{e}"}), 500

@app.post("/api/games/<int:save_id>/load")
def load_game(save_id: int):
    """Lataa tallennuksen ja asettaa sen aktiiviseksi"""
    try:
        # Tarkistetaan onko tallennus olemassa
        session = GameSession.load(save_id)

        global ACTIVE_SAVE_ID
        ACTIVE_SAVE_ID = save_id

        return jsonify({
            "Viesti": f"Peli {save_id} ladattu onnistuneesti.",
            "save_id": ACTIVE_SAVE_ID,
            "player_name": session.player_name,
            "current_day": session.current_day,
            "cash": _decimal_to_string(session.cash),
            "status": session.status,
        })
    except ValueError as e:
        if "ei löytynyt" in str(e):
            return jsonify({"virhe": f"Tallennusta {save_id} ei löytynyt"}), 404
        app.logger.exception(f"Pelin lataus {save_id} epäonnistui")
        return jsonify({"virhe": f"Pelin lataus epäonnistui: {str(e)}"}), 500
    except Exception as e:
        app.logger.exception(f"Pelin {save_id} lataus epäonnistui")
        return jsonify({"virhe": f"Pelin lataus epäonnistui: {str(e)}"}), 500

@app.get("/api/game")
def get_active_game_info():
    """Palauttaa aktiivisen pelin tietoja. Päivä, kassa, status, komentaja, tukikohta"""
    try:
        session = GameSession(save_id=ACTIVE_SAVE_ID)

        # Hae pääkenttä (home base) jos se on olemassa
        home_base = session._get_primary_base_ident()
        if not home_base:
            home_base = "EFHK"  # Oletustukikohta jos sitä ei ole vielä ostettu

        return jsonify({
            "save_id": ACTIVE_SAVE_ID,
            "player_name": session.player_name,
            "current_day": session.current_day,
            "cash": _decimal_to_string(session.cash),
            "home_base": home_base,
            "status": session.status,
            "difficulty": session.difficulty,
        })
    except ValueError as e:
        if "ei löytynyt" in str(e):
            return jsonify({"virhe": f"Aktiivista tallennusta {ACTIVE_SAVE_ID} ei löytynyt. Luo uusi peli tai lataa toinen peli."}), 404
        app.logger.exception("Aktiivisen pelin tietojen haku epäonnistui")
        return jsonify({"virhe": f"Aktiivisen pelin tietojen haku epäonnistui: {str(e)}"}), 500
    except Exception as e:
        app.logger.exception("Aktiivisen pelin tietojen haku epäonnistui")
        return jsonify({"virhe": f"Aktiivisen pelin tietojen haku epäonnistui: {str(e)}"}), 500

@app.post("/api/game/save")
def save_game():
    """Tallentaa aktiivisen pelin sen hetkisen tilan"""
    try:
        session = GameSession(save_id=ACTIVE_SAVE_ID)
        
        # Peli on automaattisesti tallennussa tietokannassa jokaisen muutoksen jälkeen
        # Tämä endpoint vain varmistaa tallennus ja palauttaa nykyisen tilan
        return jsonify({
            "viesti": f"Peli {ACTIVE_SAVE_ID} tallennettu onnistuneesti.",
            "save_id": ACTIVE_SAVE_ID,
            "player_name": session.player_name,
            "current_day": session.current_day,
            "cash": _decimal_to_string(session.cash),
            "status": session.status,
        })
    except ValueError as e:
        if "ei löytynyt" in str(e):
            return jsonify({"virhe": f"Tallennusta {ACTIVE_SAVE_ID} ei löytynyt"}), 404
        app.logger.exception(f"Pelin {ACTIVE_SAVE_ID} tallennus epäonnistui")
        return jsonify({"virhe": f"Pelin tallennus epäonnistui: {str(e)}"}), 500
    except Exception as e:
        app.logger.exception(f"Pelin {ACTIVE_SAVE_ID} tallennus epäonnistui")
        return jsonify({"virhe": f"Pelin tallennus epäonnistui: {str(e)}"}), 500
    
@app.get("/api/game/events")
def get_game_events():
    """Hakee viimeisimmät tapahtumat"""
    try:
        limit = request.args.get("limit", default=10, type=int)
        limit = max(1, min(limit, 100))
        events = _get_recent_events(limit)
        for event in events:
            event["created_at"] = str(event.get("created_at"))
        return jsonify({
            "events": events,
            "count" : len(events),
        }), 200
    except Exception as e:
        app.logger.exception("Tapahtumien haku epäonnistui")
        return jsonify({"virhe": f"Tapahtumien haku epäonnistui: {str(e)}"}), 500
    
#----------- Reitit: Päivän siirto ----------

@app.post("/api/game/advance-day")
def advance_day():
    """Siirtää peliä eteenpäin yhdellä päivällä."""
    try:
        session = GameSession(save_id=ACTIVE_SAVE_ID)
        
        result = session.advance_to_next_day(silent=True)
        
        # Synkronoidaan session tietokantaan kirjoitettujen muutosten kanssa
        session._refresh_save_state()
        
        # Lisää nykyinen päivä tulokseen
        result["day"] = session.current_day
        
        # Muunnetaan Decimalit stringeiksi
        result["earned"] = _decimal_to_string(result.get("earned"))
        if result.get("bills"):
            for bill in result["bills"]:
                bill["amount"] = _decimal_to_string(bill.get("amount"))
                bill["base"] = _decimal_to_string(bill.get("base"))
        
        return jsonify(result)
    except Exception as e:
        app.logger.exception("Päivän siirto epäonnistui")
        return jsonify({"virhe": f"Päivän siirto epäonnistui: {str(e)}"}), 500


# ---------- Reitit: Päivän siirto kunnes ensimmäinen kone palaa tai konkurssi ----------

@app.post("/api/game/fast-forward")
def fast_forward():
    """Siirrytään eteenpäin kunnes ensimmäinen lento saapuu tai konkurssi."""
    try:
        session = GameSession(save_id=ACTIVE_SAVE_ID)

        yhteys = get_connection()
        try:
            kursori = yhteys.cursor()
            kursori.execute(
                "SELECT COUNT(*) FROM flights WHERE save_id = %s AND status = 'ENROUTE'",
                (ACTIVE_SAVE_ID,),
            )
            result = kursori.fetchone()
            enroute_count = int(result[0]) if result else 0
        finally:
            try:
                kursori.close()
            except:
                pass
            yhteys.close()
        
        if enroute_count == 0:
            return jsonify({
                "viesti": "Ei käynnissä olevia lentoja.",
                "days_advanced": 0,
                "stop_reason": "NO_FLIGHTS",
            }), 400


        days_advanced = 0
        earned_total = Decimal("0.00")
        stop_reason = "max"
        day_summaries = []
        max_days = 365  # Turvamekanismi loputtomaan silmukkaan
    
        
        for _ in range(max_days):
            summary = session.advance_to_next_day(silent=True)
            days_advanced += 1
            earned_total += _to_dec(summary.get("earned", 0))
            summary_copy = summary.copy()
            summary_copy["earned"] = _decimal_to_string(summary_copy.get("earned", 0))

            for event in summary_copy.get("events", []):
                if "reward_delta" in event:
                    event["reward_delta"] = _decimal_to_string(event["reward_delta"])

            for bill in summary_copy.get("bills", []):
                if "amount" in bill:
                    bill["amount"] = _decimal_to_string(bill["amount"])
            
            day_summaries.append(summary_copy)

            # eri tilanteet pysähtymiselle

            if int(summary.get("arrivals", 0)) > 0:
                stop_reason = "arrival"
                break
            if session.status == "BANKRUPT":
                stop_reason = "bankrupt"
                break
            from upgrade_config import SURVIVAL_TARGET_DAYS
            if session.current_day > SURVIVAL_TARGET_DAYS:
                if session.status == "ACTIVE":
                    session.status = "VICTORY"
                stop_reason = "victory"
                break

        messages = {
            "arrival": f"Ensimmäinen lento palasi päivällä {session.current_day}",
            "bankrupt": f"Konkurssi keskeytti pikakelauksen päivällä {session.current_day}",
            "victory": f"Selviytymisraja saavutettu päivällä {session.current_day}!",
            "max": f"Ei paluuta {max_days} päivän aikana"
        }

        # Synkronoidaan session tietokantaan kirjoitettujen muutosten kanssa
        session._refresh_save_state()

        # Palautetaan yhteenveto

        return jsonify({
            "days_advanced": days_advanced,
            "stop_reason": stop_reason,
            "current_day": session.current_day,
            "total_earned": _decimal_to_string(earned_total),
            "message": messages.get(stop_reason, "Pikakelaus valmis"),
            "day_summaries": day_summaries,
        }), 200
    
    except ValueError as e:
        if "ei löytynyt" in str(e):
            return jsonify({"virhe": f"Tallennusta {ACTIVE_SAVE_ID} ei löytynyt"}), 404
        app.logger.exception("Pikakelaus epäonnistui")
        return jsonify({"virhe": f"Pikakelaus epäonnistui: {str(e)}"}), 500
    except Exception as e:
        app.logger.exception("Pikakelaus epäonnistui")
        return jsonify({"virhe": f"Pikakelaus epäonnistui: {str(e)}"}), 500


@app.get("/api/games")
def list_games():
    """Palauttaa listan tallennetuista peleistä JSON-muodossa."""
    try:
        saved_game_raw = _list_all_saves()

        formatted_games = [
            {
                'id': game['save_id'],
                'name': game['player_name'],
                'day': game['current_day'],
                'status': game['status'],
                'cash': _decimal_to_string(game['cash']),
                'created_at': game['created_at'],
                'updated_at': game['updated_at']
            }
        for game in saved_game_raw
        ]

        return jsonify(formatted_games)
    except Exception:
        app.logger.exception("Tallennusten haku epäonnistui.")
        return jsonify({"Virhe": "Tallennusten haku epäonnistui."}), 500

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
    """
    Hyväksyy uuden tehtävän ja kirjaa sopimuksen & lennon tietokantaan.
    Käyttää GameSession.start_new_task()-logiikkaa, mutta API-muodossa.
    
    Odottaa:
    {
        "aircraft_id": int,
        "offer": {
            "dest_ident": str,
            "dest_name": str,
            "payload_kg": int,
            "distance_km": float,
            "trips": int,
            "total_days": int,
            "reward": Decimal (tai str "1234.56"),
            "penalty": Decimal (tai str "123.45"),
            "deadline": int (päivä)
        }
    }
    """
    payload = request.get_json(silent=True) or {}
    aircraft_id = payload.get("aircraft_id")
    offer = payload.get("offer") or {}
    
    # Validaatio
    if not aircraft_id:
        return jsonify({"virhe": "aircraft_id on pakollinen"}), 400
    if not offer.get("dest_ident"):
        return jsonify({"virhe": "Tarjouksen kohde on pakollinen"}), 400
    
    try:
        session = GameSession(save_id=ACTIVE_SAVE_ID)
        
        # Varmista että kone on olemassa ja IDLE-tilassa
        yhteys = get_connection()
        kursori = yhteys.cursor(dictionary=True)
        try:
            kursori.execute(
                "SELECT aircraft_id, status, current_airport_ident, condition_percent FROM aircraft WHERE aircraft_id = %s AND save_id = %s",
                (aircraft_id, ACTIVE_SAVE_ID)
            )
            plane_row = kursori.fetchone()
        except (IndexError, TypeError):
            plane_row = None
        
        if not plane_row:
            kursori.close()
            yhteys.close()
            return jsonify({"virhe": "Konetta ei löytynyt"}), 404
        
        # Tarkista koneen status ja kunto
        try:
            status = plane_row["status"] if isinstance(plane_row, dict) else plane_row[1]
            current_ident = plane_row["current_airport_ident"] if isinstance(plane_row, dict) else plane_row[2]
            condition = int(plane_row.get("condition_percent", 0) if isinstance(plane_row, dict) else plane_row[3])
        except (KeyError, IndexError, TypeError):
            status = None
            current_ident = None
            condition = 0
        
        if status != "IDLE":
            kursori.close()
            yhteys.close()
            return jsonify({"virhe": f"Kone on tilassa {status}, ei IDLE"}), 400
        
        # Tarkista että kone on 100% kunnossa
        if condition < 100:
            kursori.close()
            yhteys.close()
            return jsonify({"virhe": f"Kone ei ole 100% kunnossa (nykyinen: {condition}%)"}), 400
        
        # Laske parametrit tarjouksesta (sama logiikka kuin CLI:ssä)
        now_day = session.current_day
        if now_day is None:
            return jsonify({"virhe": "Pelin päivää ei voitu määrittää"}), 500
        
        base_total_days = int(offer.get("total_days", 1))
        flight_days = base_total_days
        
        # Yksinkertainen event-logiikka: ei tämän kerran deterministisiä tapahtumia
        arr_day = now_day + flight_days
        delay_minutes = 0
        total_dist = float(offer.get("distance_km", 0)) * offer.get("trips", 1)
        
        # Muunna reward ja penalty Decimal-muotoon
        reward = _to_dec(offer.get("reward", "0"))
        penalty = _to_dec(offer.get("penalty", "0"))
        payload_kg = int(offer.get("payload_kg", 0))
        dest_ident = offer.get("dest_ident", "UNKN")
        
        # Kirjaa transaktio
        try:
            yhteys.start_transaction()
            
            # 1. Luo sopimus
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
                    now_day, offer.get("deadline"), now_day, None,
                    "IN_PROGRESS", 0, 0,
                    ACTIVE_SAVE_ID, aircraft_id, dest_ident, None
                ),
            )
            contract_id = kursori.lastrowid
            
            # 2. Luo lento
            kursori.execute(
                """
                INSERT INTO flights (created_day, dep_day, arrival_day, status, distance_km, schedule_delay_min,
                                     emission_kg_co2, eco_fee, dep_ident, arr_ident, aircraft_id, save_id,
                                     contract_id)
                VALUES (%s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    now_day, now_day, arr_day, "ENROUTE", total_dist, delay_minutes,
                    Decimal("0.0"), Decimal("0.00"), plane_row["current_airport_ident"], dest_ident,
                    aircraft_id, ACTIVE_SAVE_ID, contract_id
                ),
            )
            
            # 3. Päivitä koneen status
            kursori.execute(
                "UPDATE aircraft SET status = 'BUSY' WHERE aircraft_id = %s",
                (aircraft_id,)
            )
            
            # 4. Kirjaa tapahtuma
            session._log_event(
                "CONTRACT_STARTED",
                f"contract_id={contract_id}; dest={dest_ident}; payload={payload_kg}; "
                f"eta_day={arr_day}; duration_days={flight_days}",
                event_day=now_day,
                cursor=kursori,
            )
            
            yhteys.commit()
            
            kursori.close()
            yhteys.close()
            
            return jsonify({
                "viesti": f"✅ Tehtävä hyväksytty!",
                "contractId": contract_id,
                "aircraft_id": aircraft_id,
                "destination": dest_ident,
                "eta_day": arr_day,
                "reward": str(reward),
            }), 201
            
        except Exception as e:
            yhteys.rollback()
            kursori.close()
            yhteys.close()
            app.logger.exception(f"Sopimuksen luonti epäonnistui: {e}")
            return jsonify({"virhe": f"Sopimuksen luonti epäonnistui: {str(e)}"}), 500
            
    except Exception as e:
        app.logger.exception(f"Tehtävän hyväksyminen epäonnistui: {e}")
        return jsonify({"virhe": f"Tehtävän hyväksyminen epäonnistui"}), 500


# ---------- Reitit: Kauppapaikka ----------
# Kauppapaikka-endpointit hallitsevat koneiden ostamista uusien ja käytettyjen
# markkinoilta. Uudet koneet suodatetaan pelaajan tukikohdan tason (SMALL..HUGE)
# perusteella, mikä soveltaa GameSession-metodia _fetch_aircraft_models_by_base_progress().
# Käytetyt koneet tulevat market_aircraft-taulusta ja päivittyvät joka kerta
# kun pelaaja avaa markkinat (vanhat koneet poistetaan automaattisesti).

@app.get("/api/market/new")
def market_new():
    """
    Listaa myynnissä olevat uudet konemallit.
    
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
    Listaa käytettyjen koneiden markkinapaikan.
    
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
                   m.purchase_price,
                   m.condition_percent,
                   m.hours_flown,
                   m.manufactured_day,
                   m.market_notes,
                   m.listed_day
            FROM market_aircraft m
                     JOIN aircraft_models am ON am.model_code = m.model_code
            WHERE am.category != 'STARTER'
            ORDER BY m.listed_day DESC, m.market_id DESC
            LIMIT 25
            """,
        )
        for row in rows:
            row["purchase_price"] = _decimal_to_string(row.get("purchase_price"))
            row["hours_flown"] = row.get("hours_flown") or 0
            row["condition_percent"] = row.get("condition_percent") or 100
            # Lasketaan koneena ikä vuosina nykyisestä peliajasta
            # Peleissa käytetään päivän muotoa; oletetaan että peli alkaa päivästä 1
            row["age_years"] = max(0, (row.get("listed_day", 1) - row.get("manufactured_day", 1)) // 365)
            row["notes"] = row.get("market_notes") or "Hyvä kunto"
        return jsonify({"kaytetyt_koneet": rows})
    except Exception:
        app.logger.exception("Käytettyjen koneiden haku epäonnistui")
        return jsonify({"virhe": "Käytettyjen koneiden haku epäonnistui"}), 500


@app.post("/api/market/buy")
def market_buy():
    """
    Ostaa koneen markkinapaikalta (uusi tai käytetty).
    
    Odottaa:
    {
        "type": "new" | "used",
        "model_code": str (jos type="new"),
        "market_id": int (jos type="used")
    }
    """
    payload = request.get_json(silent=True) or {}
    purchase_type = (payload.get("type") or "").lower()
    
    if purchase_type not in {"new", "used"}:
        return jsonify({"virhe": "type tulee olla 'new' tai 'used'"}), 400
    
    try:
        session = GameSession(save_id=ACTIVE_SAVE_ID)
        
        if purchase_type == "new":
            # Uuden koneen osto
            model_code = payload.get("model_code")
            if not model_code:
                return jsonify({"virhe": "model_code puuttuu"}), 400
            
            # Hae koneen hinta ja tiedot
            yhteys = get_connection()
            kursori = yhteys.cursor()
            try:
                kursori.execute(
                    "SELECT model_code, model_name, purchase_price FROM aircraft_models WHERE model_code = %s",
                    (model_code,)
                )
                model_row = kursori.fetchone()
                if not model_row:
                    kursori.close()
                    yhteys.close()
                    return jsonify({"virhe": "Koneen mallia ei löytynyt"}), 404
                
                purchase_price = _to_dec(model_row[2] if not isinstance(model_row, dict) else model_row["purchase_price"])
                model_name = model_row[1] if not isinstance(model_row, dict) else model_row["model_name"]
                
            finally:
                kursori.close()
                yhteys.close()
            
            # Käytä GameSession:n metodia ostolle
            registration = session._generate_registration()
            success = session._purchase_aircraft_tx(
                model_code=model_code,
                current_airport_ident=session._get_primary_base_ident() or "EFHK",
                registration=registration,
                nickname=None,
                purchase_price=purchase_price,
                base_id=None,  # Asetetaan pääkentälle
            )
            
            if not success:
                return jsonify({"virhe": "Ostos epäonnistui: riittämätön saldo"}), 400
            
            return jsonify({
                "viesti": f"✅ Kone ostettu: {model_name}",
                "model_code": model_code,
                "model_name": model_name,
                "registration": registration,
                "purchase_price": str(purchase_price),
            }), 201
        
        else:  # purchase_type == "used"
            # Käytetyn koneen osto markkinapaikalta
            market_id = payload.get("market_id")
            if not market_id:
                return jsonify({"virhe": "market_id puuttuu"}), 400
            
            # Hae koneen tiedot market_aircraft-taulusta
            yhteys = get_connection()
            kursori = yhteys.cursor()
            try:
                kursori.execute(
                    """SELECT model_code, model_name, purchase_price, condition_percent, 
                              hours_flown FROM market_aircraft WHERE market_id = %s""",
                    (market_id,)
                )
                plane_row = kursori.fetchone()
                if not plane_row:
                    kursori.close()
                    yhteys.close()
                    return jsonify({"virhe": "Konetta ei löytynyt markkinoilta"}), 404
                
                plane_data = {
                    "market_id": market_id,
                    "model_code": plane_row[0] if not isinstance(plane_row, dict) else plane_row["model_code"],
                    "model_name": plane_row[1] if not isinstance(plane_row, dict) else plane_row["model_name"],
                    "purchase_price": plane_row[2] if not isinstance(plane_row, dict) else plane_row["purchase_price"],
                    "condition_percent": plane_row[3] if not isinstance(plane_row, dict) else plane_row["condition_percent"],
                    "hours_flown": plane_row[4] if not isinstance(plane_row, dict) else plane_row["hours_flown"],
                }
                
            finally:
                kursori.close()
                yhteys.close()
            
            # Käytä GameSession:n metodia ostolle
            success = session._purchase_market_aircraft_tx(plane_data)
            
            if not success:
                return jsonify({"virhe": "Osto epäonnistui: konetta ei enää ole saatavilla tai riittämätön saldo"}), 400
            
            return jsonify({
                "viesti": f"✅ Käytetty kone ostettu: {plane_data['model_name']}",
                "market_id": market_id,
                "model_name": plane_data["model_name"],
                "purchase_price": str(plane_data["purchase_price"]),
            }), 201
            
    except Exception as e:
        app.logger.exception(f"Koneen osto epäonnistui: {e}")
        return jsonify({"virhe": f"Koneen osto epäonnistui"}), 500


# ---------- Reitit: Kerhohuone ----------
# Kerhohuone on salainen minipelien paikka, jossa pelaaja voi pelata firman rahoillaan.
# Minipelit: Coin Flip (kruuna/klaava), High/Low (noppapeli) ja Slots (yksikätinen rosvo).
# Kaikki pelit päivittävät GameSessionin kassaa (_add_cash-metodin kautta).

@app.get("/api/clubhouse")
def clubhouse_info():
    """
    Palauttaa saatavilla olevat minipelit.
    
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
    Pelaa minipeliä (coin_flip, high_low, slots) ja päivitä kassaa GameSessionin kautta.
    
    Kutsuu GameSession.clubhouse_menu-logiikasta peliä, kuten coin flip.
    Palauttaa voittajan, tappion ja päivitetyn saldon.
    
    Pyyntö JSON-muodossa:
    { "game": "coin_flip", "bet": 1000, "choice": "heads" }
    { "game": "high_low", "bet": 1000, "choice": "high" }
    { "game": "slots", "bet": 1000 }
    
    Vastaus JSON-muodossa:
    { "game": "coin_flip", "flip": "heads", "voitto": true, "viesti": "Voitit 1000€!", "uusi_saldo": "325000" }
    """
    try:
        payload = request.get_json(silent=True) or {}
        peli = payload.get("game", "").lower()
        bet = Decimal(str(payload.get("bet", 0)))
        
        if bet <= 0:
            return jsonify({"virhe": "Panos pitää olla positiivinen"}), 400
        
        session = GameSession(save_id=ACTIVE_SAVE_ID)
        
        # Satunnaisuus: Käytä random modua minipeliin (ei seed-pohjaista)
        import random
        random.seed()  # Nollaa siemen joka kerta
        
        if peli == "coin_flip":
            choice = payload.get("choice", "heads").lower()
            flip = random.choice(["heads", "tails"])
            voitto = choice == flip
            
            if voitto:
                session._add_cash(bet, context="Minipeli: Kolikon heitto - voitto")
                viesti = f"Voitit {_decimal_to_string(bet)}€! 🎉"
            else:
                session._add_cash(-bet, context="Minipeli: Kolikon heitto - tappio")
                viesti = f"Hävisit {_decimal_to_string(bet)}€ 😢"
            
            return jsonify({
                "game": "coin_flip",
                "flip": flip,
                "voitto": voitto,
                "viesti": viesti,
                "uusi_saldo": _decimal_to_string(session.cash)
            })
        
        elif peli == "high_low":
            choice = payload.get("choice", "high").lower()
            dice1 = random.randint(1, 6)
            dice2 = random.randint(1, 6)
            
            is_high = dice2 > dice1
            is_low = dice2 < dice1
            is_push = dice1 == dice2
            
            voitto = (choice == "high" and is_high) or (choice == "low" and is_low)
            
            if voitto:
                session._add_cash(bet, context="Minipeli: Noppa - voitto")
                viesti = f"Voitit {_decimal_to_string(bet)}€! 🎉"
            elif is_push:
                viesti = f"Tasapeli - saldo ei muuttunut"
                voitto = None  # Push
            else:
                session._add_cash(-bet, context="Minipeli: Noppa - tappio")
                viesti = f"Hävisit {_decimal_to_string(bet)}€ 😢"
            
            return jsonify({
                "game": "high_low",
                "dice1": dice1,
                "dice2": dice2,
                "voitto": voitto,
                "push": is_push,
                "viesti": viesti,
                "uusi_saldo": _decimal_to_string(session.cash)
            })
        
        elif peli == "slots":
            # Kolikkopeli: 3 kiekkoa, voitot vaihtelevat
            reels = [random.choice(['🍒', '🍊', '💎', '7️⃣', '🎰']) for _ in range(3)]
            
            # Voitto-logiikka
            if reels[0] == reels[1] == reels[2]:
                if reels[0] == '💎':
                    multiplier = Decimal("50")
                elif reels[0] == '7️⃣':
                    multiplier = Decimal("30")
                else:
                    multiplier = Decimal("10")
                voitto_saldo = bet * multiplier
                session._add_cash(voitto_saldo, context="Minipeli: Slots - jackpot")
                viesti = f"JACKPOT! Voitit {_decimal_to_string(voitto_saldo)}€! 🎉"
                voitto = True
            elif reels[0] == reels[1] or reels[1] == reels[2]:
                voitto_saldo = bet * Decimal("2")
                session._add_cash(voitto_saldo, context="Minipeli: Slots - voitto")
                viesti = f"Kaksi samaa! Voitit {_decimal_to_string(voitto_saldo)}€! 👍"
                voitto = True
            else:
                session._add_cash(-bet, context="Minipeli: Slots - tappio")
                viesti = f"Ei voittoa. Hävisit {_decimal_to_string(bet)}€ 😢"
                voitto = False
            
            return jsonify({
                "game": "slots",
                "reels": reels,
                "voitto": voitto,
                "viesti": viesti,
                "uusi_saldo": _decimal_to_string(session.cash)
            })
        
        else:
            return jsonify({"virhe": f"Tuntematon peli: {peli}"}), 400
    
    except Exception as e:
        app.logger.exception(f"Clubhouse-pelin virhe")
        return jsonify({"virhe": f"Pelin virhe: {str(e)}"}), 500

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
    return jsonify({"save_id": ACTIVE_SAVE_ID, "aircraft": out})


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
    """Korjaa lentokoneen täydelliseksi (100% kuntoon)."""
    
    session = GameSession(save_id=ACTIVE_SAVE_ID)
    
    # Tarkista että kone kuuluu pelaajalle
    row = _fetch_one_dict(
        "SELECT condition_percent, status FROM aircraft WHERE aircraft_id=%s AND save_id=%s",
        (aircraft_id, ACTIVE_SAVE_ID),
    )
    if not row:
        return jsonify({"virhe": "Konetta ei löytynyt"}), 404
    
    current_cond = int(row.get("condition_percent") or 0)
    
    # Käytä GameSession-metodia korjaukseen (transaktiot, logging, etc.)
    success = session._repair_aircraft_to_full_tx(aircraft_id)
    
    if not success:
        return jsonify({"virhe": "Korjaus epäonnistui"}), 400
    
    # Hae päivitetyt tiedot
    updated_row = _fetch_one_dict(
        "SELECT condition_percent FROM aircraft WHERE aircraft_id=%s",
        (aircraft_id,),
    )
    new_cond = int(updated_row.get("condition_percent", 0)) if updated_row else 100
    
    # Laske hinta (sama kaava kuin GameSessionissa)
    missing = max(0, 100 - current_cond)
    repair_cost = (Decimal(missing) * REPAIR_COST_PER_PERCENT).quantize(Decimal("0.01"))
    
    return jsonify({
        "status": "ok",
        "viesti": f"✅ Kone korjattu! Hinta: €{_decimal_to_string(repair_cost)}",
        "aircraft_id": aircraft_id,
        "previous_condition": current_cond,
        "new_condition": new_cond,
        "cost": _decimal_to_string(repair_cost),
        "remaining_cash": _decimal_to_string(session.cash),
    }), 200


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


@app.get("/api/bases/capacity")
def api_bases_capacity():
    """Palauttaa tukikohtien kapasiteettitiedot."""
    try:
        capacity_info = get_base_capacity_info(ACTIVE_SAVE_ID)
        return jsonify({"bases_capacity": capacity_info})
    except Exception as e:
        app.logger.exception("Kapasiteettitietojen haku epäonnistui")
        return jsonify({"virhe": "capacity fetch failed", "detail": str(e)}), 500


@app.get("/api/bases/available")
def api_available_bases():
    """Palauttaa listan ostettavissa olevista tukikohdista."""
    try:
        # Get already owned base idents
        owned = fetch_owned_bases(ACTIVE_SAVE_ID) or []
        owned_idents = set(b.get("base_ident") for b in owned)
        
        # Fetch large airports that can be bases (excluding already owned)
        # Only large_airport and medium_airport types are suitable for bases
        sql = """
            SELECT 
                ident,
                name,
                iso_country,
                municipality,
                type,
                latitude_deg,
                longitude_deg
            FROM airport
            WHERE type IN ('large_airport', 'medium_airport')
            AND ident NOT IN ({})
            ORDER BY iso_country, name
            LIMIT 100
        """.format(','.join(['%s'] * len(owned_idents)) if owned_idents else "'__none__'")
        
        rows = _query_dicts(sql, tuple(owned_idents) if owned_idents else ())
        
        # Calculate base price based on airport type and location
        result = []
        for row in rows:
            airport_type = row.get("type", "medium_airport")
            # Large airports cost more
            base_price = 150000 if airport_type == "large_airport" else 75000
            
            # Add some variation based on country (major hubs cost more)
            country = row.get("iso_country", "")
            if country in ("US", "GB", "DE", "FR", "JP"):
                base_price *= 1.5
            elif country in ("FI", "SE", "NO", "DK"):
                base_price *= 1.2
            
            result.append({
                "ident": row.get("ident"),
                "name": row.get("name"),
                "country": country,
                "municipality": row.get("municipality"),
                "type": airport_type,
                "purchase_price": _decimal_to_string(Decimal(str(base_price))),
                "max_capacity": 2,  # All new bases start at SMALL level
                "latitude": row.get("latitude_deg"),
                "longitude": row.get("longitude_deg"),
            })
        
        return jsonify({"available_bases": result})
    except Exception as e:
        app.logger.exception("Ostettavien tukikohtien haku epäonnistui")
        return jsonify({"virhe": "available bases fetch failed", "detail": str(e)}), 500


@app.post("/api/bases/buy")
def api_buy_base():
    """Osta uusi tukikohta."""
    payload = request.get_json(silent=True) or {}
    ident = payload.get("ident")
    
    if not ident:
        return jsonify({"virhe": "ident required"}), 400
    
    try:
        # Check if already owned
        owned = fetch_owned_bases(ACTIVE_SAVE_ID) or []
        owned_idents = set(b.get("base_ident") for b in owned)
        if ident in owned_idents:
            return jsonify({"virhe": "already_owned"}), 409
        
        # Get airport info
        airport = _fetch_one_dict(
            "SELECT ident, name, iso_country, type FROM airport WHERE ident = %s",
            (ident,)
        )
        if not airport:
            return jsonify({"virhe": "airport_not_found"}), 404
        
        # Calculate price
        airport_type = airport.get("type", "medium_airport")
        base_price = Decimal("150000") if airport_type == "large_airport" else Decimal("75000")
        country = airport.get("iso_country", "")
        if country in ("US", "GB", "DE", "FR", "JP"):
            base_price *= Decimal("1.5")
        elif country in ("FI", "SE", "NO", "DK"):
            base_price *= Decimal("1.2")
        
        # Check funds
        session = GameSession(save_id=ACTIVE_SAVE_ID)
        if session.cash < base_price:
            return jsonify({"virhe": "insufficient_funds"}), 402
        
        # Insert new base
        from datetime import datetime
        now = datetime.utcnow()
        yhteys = get_connection()
        kursori = None
        try:
            kursori = yhteys.cursor()
            kursori.execute(
                """
                INSERT INTO owned_bases 
                (save_id, base_ident, base_name, acquired_day, purchase_cost, is_headquarters, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (ACTIVE_SAVE_ID, ident, airport.get("name"), session.current_day, float(base_price), False, now, now)
            )
            new_base_id = kursori.lastrowid
            yhteys.commit()
        finally:
            if kursori:
                kursori.close()
            yhteys.close()
        
        # Charge the player
        session._add_cash(-base_price, context="BASE_PURCHASE")
        
        return jsonify({
            "status": "ok",
            "base_id": new_base_id,
            "base_ident": ident,
            "base_name": airport.get("name"),
            "purchase_cost": _decimal_to_string(base_price),
            "remaining_cash": _decimal_to_string(session.cash),
        }), 201
        
    except Exception as e:
        app.logger.exception("Base purchase failed")
        return jsonify({"virhe": "purchase_failed", "detail": str(e)}), 500


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


# ---------- Reitit: Uutiset / Random Events ----------

@app.get("/api/events")
def get_recent_events():
    """Palauttaa viimeisimmät satunnaiset tapahtumatehtävät päivittäisen news-widgetin käyttöön.
    
    Näyttää tapahtumia viimeisimmiltä päiviltä (max 4).
    """
    try:
        from event_system import get_event_for_day
        
        session = GameSession(save_id=ACTIVE_SAVE_ID)
        current_day = session.current_day
        if current_day is None:
            current_day = 1
        
        # Hae tapahtumia viimeisimmältä 4 päivältä
        events = []
        yhteys = get_connection()
        kursori = None
        
        try:
            kursori = yhteys.cursor(dictionary=True)
        except TypeError:
            kursori = yhteys.cursor()
        
        try:
            # Hae random_events taulusta kaikki tapahtumat, jotta voidaan yhdistää tiedot
            kursori.execute("""
                SELECT event_id, event_name, description, weather_description 
                FROM random_events
                ORDER BY event_id ASC
            """)
            event_defs = {}
            for row in kursori.fetchall():
                if isinstance(row, dict):
                    event_defs[row['event_name']] = {
                        'name': row['event_name'],
                        'description': row['description'],
                        'weather_description': row.get('weather_description')
                    }
                else:
                    event_name = row[1] if len(row) > 1 else row.get('event_name')
                    description = row[2] if len(row) > 2 else row.get('description')
                    weather_desc = row[3] if len(row) > 3 else row.get('weather_description')
                    event_defs[event_name] = {
                        'name': event_name,
                        'description': description,
                        'weather_description': weather_desc
                    }
            
            # Hae viimeisimmät 4 päivää tapahtumistaan
            days_to_check = min(4, current_day)
            for day_offset in range(days_to_check):
                check_day = current_day - day_offset
                if check_day <= 0:
                    break
                    
                kursori.execute("""
                    SELECT event_name FROM player_fate 
                    WHERE seed = %s AND day = %s 
                    LIMIT 1
                """, (session.rng_seed, check_day))
                
                row = kursori.fetchone()
                if row:
                    event_name = row[0] if not isinstance(row, dict) else row.get('event_name')
                    if event_name is None:
                        continue
                        
                    event_info = event_defs.get(event_name, {
                        'name': event_name,
                        'description': '',
                        'weather_description': ''
                    })
                    
                    # Määritä event-tyyppi ja väri
                    event_type = 'normal'
                    color_class = 'cyan'
                    
                    event_name_lower = str(event_name).lower()
                    
                    # Negatiiviset eventit
                    if event_name in ['Volcano', 'Freezing Cold', 'Storm Clouds', 'Hurricane', 'Meteor', 'Workers Strike']:
                        event_type = 'negative'
                        color_class = 'red'
                    # Positiiviset eventit
                    elif event_name in ['Sunny Sky', 'Favorable Winds', 'Best Day Ever']:
                        event_type = 'positive'
                        color_class = 'green'
                    # Neutraalit/outot eventit
                    elif event_name in ['Aliens']:
                        event_type = 'warning'
                        color_class = 'amber'
                    # Normaalit
                    elif event_name in ['Normal Day']:
                        event_type = 'normal'
                        color_class = 'cyan'
                    
                    events.append({
                        'day': check_day,
                        'event_name': event_name,
                        'description': event_info.get('description', ''),
                        'weather_description': event_info.get('weather_description', ''),
                        'type': event_type,
                        'color': color_class
                    })
            
            # Jos ei tapahtumia, palauta placeholder
            if not events:
                events.append({
                    'day': current_day,
                    'event_name': 'Normal Day',
                    'description': 'Normaali lentopäivä ilman erityistä tapahtumaa',
                    'weather_description': 'Mitään erityistä! Tavanomainen päivä operaatioissa.',
                    'type': 'normal',
                    'color': 'cyan'
                })
            
            return jsonify({
                'current_day': current_day,
                'events': events
            })
            
        finally:
            if kursori:
                try:
                    kursori.close()
                except:
                    pass
            yhteys.close()
            
    except Exception as e:
        app.logger.exception("Tapahtumien haku epäonnistui")
        return jsonify({
            'current_day': 0,
            'events': [{
                'day': 0,
                'event_name': 'Virhe',
                'description': f'Tapahtumien haku epäonnistui: {str(e)}',
                'type': 'error',
                'color': 'red'
            }]
        }), 500


# ---------- Staattiset tiedostot (Frontend) ----------

@app.route('/')
def serve_index():
    """Palauttaa pääsivun (index.html)"""
    static_dir = os.path.join(os.path.dirname(__file__), 'static')
    return send_from_directory(static_dir, 'index.html')


@app.route('/<path:filename>')
def serve_static(filename):
    """Palauttaa kaikki staattiset tiedostot (JS, CSS, kuvat)"""
    static_dir = os.path.join(os.path.dirname(__file__), 'static')
    return send_from_directory(static_dir, filename)


if __name__ == "__main__":
    app.run(debug=True, port=3000)