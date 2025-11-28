"""Flask-pohjainen rajapinta"""

import os
import random
from decimal import Decimal
from typing import Any, Dict, List, Optional

from flask import Flask, jsonify, request, send_from_directory

from game_session import GameSession
from utils import get_connection

app = Flask(__name__, static_folder='static')
# Tämä kertoo minkä tallennuksen tietoja API lukee; oletuksena käytetään slot 1:tä.
ACTIVE_SAVE_ID = int(os.environ.get("AFC_ACTIVE_SAVE_ID", 1))
# Näin monta tarjousta pyydetään kerralla GameSessionilta.
DEFAULT_TASK_OFFER_COUNT = 5


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


# ---------- Reitit: Tehtävät ----------

@app.get("/api/tasks")
def list_tasks():
    """Palauttaa aktiiviset sopimukset JSONina."""
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
    """Generoi tarjouksia käyttämällä GameSession-logiikkaa."""
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
def accept_task_stub():
    """Hyväksyy tehtävän stub-muodossa ja palauttaa TODO-viestin."""
    payload = request.get_json(silent=True) or {}
    aircraft_id = payload.get("aircraft_id")
    offer = payload.get("offer") or {}
    if not aircraft_id:
        return jsonify({"virhe": "aircraft_id on pakollinen"}), 400
    if not offer.get("dest_ident"):
        return jsonify({"virhe": "Tarjouksen kohde on pakollinen"}), 400

    # TODO: Toteuta oikea sopimuksen luonnin tietokantapolku
    response = {
        "viesti": "Tehtävä otettiin vastaan stub-tilassa",
        "aircraft_id": aircraft_id,
        "kohde": offer.get("dest_ident"),
        "payload_kg": offer.get("payload_kg"),
        "reward": offer.get("reward"),
        "todo": "TODO: Kirjaa sopimus ja lento tietokantaan",
    }
    return jsonify(response), 201


# ---------- Reitit: Kauppapaikka ----------

@app.get("/api/market/new")
def market_new():
    """Listaa uudet konemallit perusmuodossa."""
    try:
        rows = _query_dicts(
            """
            SELECT model_code,
                   manufacturer,
                   model_name,
                   purchase_price,
                   base_cargo_kg,
                   cruise_speed_kts,
                   eco_fee_multiplier
            FROM aircraft_models
            ORDER BY purchase_price ASC
            LIMIT 25
            """,
        )
        for row in rows:
            row["purchase_price"] = _decimal_to_string(row.get("purchase_price"))
        return jsonify({"uudet_koneet": rows})
    except Exception:
        app.logger.exception("Uusien koneiden haku epäonnistui")
        return jsonify({"virhe": "Uusien koneiden haku epäonnistui"}), 500


@app.get("/api/market/used")
def market_used():
    """Listaa käytetyt markkinakoneet."""
    try:
        rows = _query_dicts(
            """
            SELECT m.market_id,
                   m.model_code,
                   am.model_name,
                   m.purchase_price,
                   m.condition_percent,
                   m.hours_flown,
                   m.listed_day
            FROM market_aircraft m
                     JOIN aircraft_models am ON am.model_code = m.model_code
            ORDER BY m.listed_day DESC, m.market_id DESC
            LIMIT 25
            """,
        )
        for row in rows:
            row["purchase_price"] = _decimal_to_string(row.get("purchase_price"))
        return jsonify({"kaytetyt_koneet": rows})
    except Exception:
        app.logger.exception("Käytettyjen koneiden haku epäonnistui")
        return jsonify({"virhe": "Käytettyjen koneiden haku epäonnistui"}), 500


@app.post("/api/market/buy")
def market_buy_stub():
    """Stub ostolle: tarkistaa syötteen ja palauttaa vahvistuksen."""
    payload = request.get_json(silent=True) or {}
    purchase_type = (payload.get("type") or "").lower()
    if purchase_type not in {"new", "used"}:
        return jsonify({"virhe": "type tulee olla 'new' tai 'used'"}), 400

    if purchase_type == "new" and not payload.get("model_code"):
        return jsonify({"virhe": "model_code puuttuu"}), 400
    if purchase_type == "used" and not payload.get("market_id"):
        return jsonify({"virhe": "market_id puuttuu"}), 400

    # TODO: Kirjaa maksu, luo kone pelaajalle ja poista merkintä markkinasta
    response = {
        "viesti": "Osto kirjattiin stubina",
        "type": purchase_type,
        "model_code": payload.get("model_code"),
        "market_id": payload.get("market_id"),
        "todo": "TODO: Lisää oikea tietokantakäsittely",
    }
    return jsonify(response), 202


# ---------- Reitit: Kerhohuone ----------

@app.get("/api/clubhouse")
def clubhouse_info():
    """Palauttaa minipelien perustiedot."""
    games = [
        {"nimi": "coin_flip", "kuvaus": "Tupla tai kuitti kolikolla"},
        {"nimi": "fuel_quiz", "kuvaus": "Arvaa paljonko tankki vetää"},
    ]
    return jsonify({"pelit": games})


@app.post("/api/clubhouse")
def clubhouse_play():
    """Simppeli coin flip -stub, joka palauttaa suomenkielisen vastauksen."""
    payload = request.get_json(silent=True) or {}
    peli = payload.get("game")
    if peli != "coin_flip":
        return jsonify({"virhe": "Tällä hetkellä vain coin_flip on tuettu"}), 400

    choice = (payload.get("choice") or "heads").lower()
    bet = int(payload.get("bet") or 0)
    flip = random.choice(["heads", "tails"])
    win = choice == flip
    # TODO: Sido kassamuutos oikeaan tallennukseen
    message = f"Voitit {bet} euroa" if win else f"Hävisit {bet} euroa"
    return jsonify(
        {
            "flip": flip,
            "voitto": win,
            "viesti": message,
            "todo": "TODO: Päivitä kassaa GameSessionin kautta",
        }
    )

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

# ---------- Staattiset tiedostot (Frontend) ----------

@app.route('/')
def serve_index():
    """Palauttaa pääsivun (index.html)"""
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/<path:path>')
def serve_static(path):
    """Palauttaa staattiset tiedostot (CSS, JS)"""
    return send_from_directory(app.static_folder, path)


if __name__ == "__main__":
    # Kehityskäyttöön sopiva debug-palvelin.
    app.run(debug=True)
