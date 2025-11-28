"""
session_helpers - Apufunktiot pelilogiikkaan
================================================
Tämä moduuli kokoaa yhteen GameSession-luokasta irroitetut apufunktiot,
jotka helpottavat yhtenäistä logiikkaa backendin eri osissa.

Sisältö:
--------
- common: Yhteiset apurit (Decimal-muunnokset, ikonien formatointi)
- aircraft: Lentokoneiden haku, päivitysten laskenta ja soveltaminen
- bases: Tukikohtien hallinta ja päivitykset

Käyttö:
-------
from session_helpers import _to_dec, fetch_player_aircrafts_with_model_info

# Esimerkki:
aircrafts = fetch_player_aircrafts_with_model_info(yhteys, save_id)
cost = calc_aircraft_upgrade_cost(current_eco, target_eco)
"""

from .common import _to_dec, _icon_title
from .aircraft import (
    fetch_player_aircrafts_with_model_info,
    get_current_aircraft_upgrade_state,
    compute_effective_eco_multiplier,
    calc_aircraft_upgrade_cost,
    apply_aircraft_upgrade,
    get_effective_eco_for_aircraft,
)
from .bases import (
    fetch_owned_bases,
    fetch_base_current_level_map,
    insert_base_upgrade,
)

__all__ = [
    # Yhteiset työkalut
    "_to_dec",              # Muuntaa arvon Decimal-tyypiksi (rahamäärille)
    "_icon_title",          # Palauttaa emoji-ikonin ja otsikon parhaalle tiedolle
    
    # Lentokoneiden hallinta
    "fetch_player_aircrafts_with_model_info",  # Hakee pelaajan koneet + mallin tiedot
    "get_current_aircraft_upgrade_state",      # Palauttaa koneen nykyisen ECO-tason
    "compute_effective_eco_multiplier",        # Laskee efektiivisen ECO-kertoimen
    "calc_aircraft_upgrade_cost",              # Laskee ECO-päivityksen hinnan
    "apply_aircraft_upgrade",                  # Päivittää koneen ECO-tason tietokantaan
    "get_effective_eco_for_aircraft",          # Hakee koneen efektiivisen ECO:n
    
    # Tukikohtien hallinta
    "fetch_owned_bases",           # Hakee pelaajan omistamat tukikohdat
    "fetch_base_current_level_map", # Palauttaa tukikohtien nykyiset tasot
    "insert_base_upgrade",         # Lisää tukikohdan päivityksen tietokantaan
]
