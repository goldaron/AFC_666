"""
bases.py - Tukikohtien tietokanta-apurit
=========================================
Sisältää funktiot tukikohtien:
- Omistuksen hallintaan (owned_bases)
- Päivitystasojen seurantaan (base_upgrades)
- Päivityshistorian tallennukseen

Tukikohdat:
- Jokaisella on base_id ja base_ident (ICAO-koodi)
- Päivitykset tallennetaan base_upgrades-tauluun upgrade_code:lla
- Viimeisin upgrade_code kertoo nykyisen tason
"""

from typing import Dict, List

from utils import get_connection

from .common import _to_dec


def fetch_owned_bases(save_id: int) -> List[dict]:
    """
    Hakee pelaajan omistamat tukikohdat järjestettynä nimen mukaan.
    
    Args:
        save_id: Tallennuksen ID
    
    Returns:
        Lista dictionary-objekteja kentillä:
        - base_id: Tukikohdan ID
        - base_ident: ICAO-koodi (esim. EFHK)
        - base_name: Tukikohdan nimi (esim. Helsinki-Vantaa)
        - purchase_cost: Ostohinta
    """
    sql = """
        SELECT base_id, base_ident, base_name, purchase_cost
        FROM owned_bases
        WHERE save_id = %s
        ORDER BY base_name
    """
    with get_connection() as yhteys:
        kursori = yhteys.cursor(dictionary=True)
        kursori.execute(sql, (save_id,))
        return kursori.fetchall() or []


def fetch_base_current_level_map(base_ids: List[int]) -> Dict[int, str]:
    """
    Palauttaa tukikohtien nykyiset päivitystasot.
    
    Hakee base_upgrades-taulusta viimeisimmän upgrade_code:n kullekin
    tukikohdalle. Käyttää subquerya löytääkseen viimeisimmän rivin.
    
    Args:
        base_ids: Lista tukikohtien ID:tä
    
    Returns:
        Dictionary: {base_id: upgrade_code}
        Esim. {1: "LVL2", 3: "LVL1"}
        
    Huom: Jos tukikohdalla ei ole päivityksiä, sitä ei ole mapissa.
    """
    if not base_ids:
        return {}

    placeholders = ",".join(["%s"] * len(base_ids))
    sql = f"""
        SELECT bu.base_id, bu.upgrade_code
        FROM base_upgrades bu
        JOIN (
            SELECT base_id, MAX(base_upgrade_id) AS maxid
            FROM base_upgrades
            WHERE base_id IN ({placeholders})
            GROUP BY base_id
        ) x ON x.base_id = bu.base_id AND x.maxid = bu.base_upgrade_id
    """
    with get_connection() as yhteys:
        kursori = yhteys.cursor(dictionary=True)
        kursori.execute(sql, tuple(base_ids))
        rows = kursori.fetchall() or []
    return {r["base_id"]: r["upgrade_code"] for r in rows}


def insert_base_upgrade(base_id: int, next_level_code: str, cost, day: int) -> None:
    """
    Lisää tukikohdan päivityshistoriaan uuden rivin.
    
    Tallentaa päivityksen base_upgrades-tauluun. Tämä funktio EI vähennä
    rahaa - kutsuja vastaa siitä että transaktio on hoidettu.
    
    Args:
        base_id: Tukikohdan ID
        next_level_code: Uusi päivitystaso (esim. "LVL1", "LVL2")
        cost: Päivityksen hinta (Decimal tai numero)
        day: Päivä jolloin päivitys asennettiin
    
    Esimerkki:
        insert_base_upgrade(base_id=1, next_level_code="LVL2", 
                           cost=Decimal("50000.00"), day=10)
    """
    sql = """
        INSERT INTO base_upgrades (base_id, upgrade_code, installed_day, upgrade_cost)
        VALUES (%s, %s, %s, %s)
    """
    with get_connection() as yhteys:
        kursori = yhteys.cursor()
        kursori.execute(
            sql,
            (
                int(base_id),
                str(next_level_code),
                int(day),
                float(_to_dec(cost)),
            ),
        )
