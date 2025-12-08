"""
aircraft.py - Lentokoneiden tietokanta-apurit
==============================================
Sisältää funktiot lentokoneiden:
- Hakemiseen (model_info mukaan lukien)
- ECO-päivitysten hallintaan ja laskentaan
- Efektiivisen ECO-kertoimen laskemiseen

ECO-päivitysjärjestelmä:
- Jokainen päivitys nostaa tasoa +1
- Kerroin paranee 5% per taso (1.05^level)
- Min 0.50, Max 5.00
- STARTER-koneet: kiinteä hinta + kasvu
- Muut koneet: prosentti ostohinnasta + kasvu
"""

from decimal import Decimal, ROUND_HALF_UP
from typing import List

from upgrade_config import (
    UPGRADE_CODE,
    STARTER_BASE_COST,
    STARTER_GROWTH,
    NON_STARTER_BASE_PCT,
    NON_STARTER_MIN_BASE,
    NON_STARTER_GROWTH,
)
from utils import get_connection

from .common import _to_dec


def fetch_player_aircrafts_with_model_info(save_id: int) -> List[dict]:
    """
    Hakee pelaajan kaikki myymättömät lentokoneet mallin metatiedoilla.
    
    Palauttaa koneet yhdistettynä aircraft_models-tauluun, jotta saadaan
    esim. model_name, category, eco_fee_multiplier mukaan.
    
    Args:
        save_id: Tallennuksen ID
    
    Returns:
        Lista dictionary-objekteja, joissa kentät:
        - aircraft_id, registration, model_code
        - model_name, category
        - purchase_price_aircraft, purchase_price_model
        - eco_fee_multiplier
        - condition_percent, hours_flown, status
        - current_airport_ident, acquired_day
    """
    sql = """
        SELECT
            a.aircraft_id,
            a.registration,
            a.model_code,
            a.current_airport_ident,
            a.condition_percent,
            a.hours_flown,
            a.status,
            a.acquired_day,
            a.purchase_price  AS purchase_price_aircraft,
            am.model_name,
            am.category,
            am.purchase_price AS purchase_price_model,
            am.eco_fee_multiplier
        FROM aircraft a
        JOIN aircraft_models am ON am.model_code = a.model_code
        WHERE a.save_id = %s
          AND (a.sold_day IS NULL OR a.sold_day = 0)
        ORDER BY a.aircraft_id
    """
    yhteys = get_connection()
    kursori = None
    try:
        kursori = yhteys.cursor(dictionary=True)
        kursori.execute(sql, (save_id,))
        return kursori.fetchall() or []
    finally:
        if kursori is not None:
            try:
                kursori.close()
            except Exception:
                pass
        yhteys.close()


def get_current_aircraft_upgrade_state(aircraft_id: int, upgrade_code: str = UPGRADE_CODE) -> dict:
    """
    Palauttaa koneen viimeisimmän päivitystason.
    
    Hakee aircraft_upgrades-taulusta suurimman tason annetulle koneelle
    ja päivityskoodille (oletuksena ECO).
    
    Args:
        aircraft_id: Koneen ID
        upgrade_code: Päivitystyyppi (oletus 'ECO')
    
    Returns:
        {"level": int} - Taso 0 jos ei päivityksiä
    """
    sql = """
        SELECT level
        FROM aircraft_upgrades
        WHERE aircraft_id = %s
          AND upgrade_code = %s
        ORDER BY aircraft_upgrade_id DESC
        LIMIT 1
    """
    with get_connection() as yhteys:
        kursori = yhteys.cursor(dictionary=True)
        kursori.execute(sql, (aircraft_id, upgrade_code))
        row = kursori.fetchone()

    if not row:
        return {"level": 0}

    return {"level": int(row.get("level") or 0)}


def compute_effective_eco_multiplier(aircraft_id: int, base_eco_multiplier: float) -> float:
    """
    Laskee efektiivisen ECO-kertoimen ottaen huomioon asennetut päivitykset.
    
    Kaava:
    - Peruskerroin * (1.05 ^ taso)
    - Rajattu välille [0.50, 5.00]
    
    Args:
        aircraft_id: Koneen ID
        base_eco_multiplier: Mallin perus-ECO (aircraft_models.eco_fee_multiplier)
    
    Returns:
        float: Efektiivinen ECO-kerroin
    
    Esimerkki:
        Perus 1.0, taso 3 → 1.0 * 1.05^3 ≈ 1.1576 → 1.16
    """
    state = get_current_aircraft_upgrade_state(aircraft_id)
    level = int(state["level"])

    factor_per_level = Decimal("1.05")
    base_dec = Decimal(str(base_eco_multiplier))
    effective_multiplier = base_dec * (factor_per_level ** level)

    # Rajat: min 0.50, max 5.00
    floor = Decimal("0.50")
    cap = Decimal("5.00")
    final_multiplier = max(floor, min(effective_multiplier, cap))
    return float(final_multiplier)


def calc_aircraft_upgrade_cost(aircraft_row: dict, next_level: int) -> Decimal:
    """
    Laskee seuraavan ECO-päivitystason hinnan koneelle.
    
    Hinnoittelu riippuu kategoriasta:
    - STARTER: kiinteä perushinta + eksponentiaalinen kasvu
    - Muut: prosentti ostohinnasta + eksponentiaalinen kasvu
    
    Args:
        aircraft_row: Koneen tiedot (category, purchase_price_*)
        next_level: Seuraava taso (esim. 1, 2, 3...)
    
    Returns:
        Decimal: Päivityksen hinta pyöristettynä sentteihin
    
    Käyttää upgrade_config.py -parametreja:
    - STARTER_BASE_COST, STARTER_GROWTH
    - NON_STARTER_BASE_PCT, NON_STARTER_MIN_BASE, NON_STARTER_GROWTH
    """
    is_starter = (str(aircraft_row.get("category") or "").upper() == "STARTER")
    if is_starter:
        base = STARTER_BASE_COST
        growth = STARTER_GROWTH
    else:
        purchase_price = (
            aircraft_row.get("purchase_price_aircraft")
            or aircraft_row.get("purchase_price_model")
            or 0
        )
        base = max(NON_STARTER_MIN_BASE, (_to_dec(purchase_price) * NON_STARTER_BASE_PCT))
        growth = NON_STARTER_GROWTH

    # Hinta = perushinta * (kasvukerroin ^ (taso - 1))
    cost = (base * (growth ** (_to_dec(next_level) - _to_dec(1)))).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    return cost


def apply_aircraft_upgrade(aircraft_id: int, installed_day: int) -> int:
    """
    Asentaa uuden päivityksen koneelle (lisää rivin aircraft_upgrades-tauluun).
    
    Nostaa päivitystasoa yhdellä ja tallentaa asennuspäivän.
    
    Args:
        aircraft_id: Koneen ID
        installed_day: Päivä jolloin päivitys asennettiin
    
    Returns:
        int: Uusi päivitystaso
    
    Huom: Olettaa että raha on jo vähennetty ja transaktio hoidettu kutsujassa.
    """
    state = get_current_aircraft_upgrade_state(aircraft_id)
    new_level = int(state["level"]) + 1

    sql = """
        INSERT INTO aircraft_upgrades
            (aircraft_id, upgrade_code, level, installed_day)
        VALUES
            (%s, %s, %s, %s)
    """
    with get_connection() as yhteys:
        kursori = yhteys.cursor()
        kursori.execute(
            sql,
            (
                int(aircraft_id),
                str(UPGRADE_CODE),
                int(new_level),
                int(installed_day),
            ),
        )
    return new_level


def get_effective_eco_for_aircraft(aircraft_id: int) -> float:
    """
    Hakee koneen efektiivisen ECO-kertoimen (perus + päivitykset).
    
    Yhdistelmäfunktio joka:
    1. Hakee mallin perus-ECO:n
    2. Soveltaa päivitykset compute_effective_eco_multiplier():lla
    
    Args:
        aircraft_id: Koneen ID
    
    Returns:
        float: Efektiivinen ECO-kerroin
    
    Käyttö:
    - Lentojen kustannuslaskennassa
    - UI:ssa näytettäessä koneen nykyistä ECO-tasoa
    """
    sql = """
        SELECT am.eco_fee_multiplier
        FROM aircraft a
        JOIN aircraft_models am ON am.model_code = a.model_code
        WHERE a.aircraft_id = %s
    """
    with get_connection() as yhteys:
        kursori = yhteys.cursor()
        kursori.execute(sql, (aircraft_id,))
        row = kursori.fetchone()

    # Haetaan perus-ECO
    if row is None:
        base_eco = 1.0
    elif isinstance(row, dict):
        base_eco = row.get("eco_fee_multiplier", 1.0)
    else:
        base_eco = row[0] if row[0] is not None else 1.0

    # Sovella päivitykset
    return compute_effective_eco_multiplier(aircraft_id, base_eco)
