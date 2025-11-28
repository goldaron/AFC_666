"""
common.py - Yhteiset apufunktiot
=================================
Sisältää perustyökaluja, joita käytetään läpi projektin:
- Decimal-muunnokset rahamäärille
- Konsolitekstien muotoilu (CLI-versio)
"""

from decimal import Decimal


def _to_dec(x):
    """
    Muuntaa arvon turvallisesti Decimal-tyypiksi.
    
    Tämä funktio varmistaa että kaikki rahamäärät käsitellään yhtenäisesti
    Decimal-tyyppinä välttäen liukulukujen pyöristysvirheet.
    
    Args:
        x: Mikä tahansa arvo (int, float, str, Decimal tai None)
    
    Returns:
        Decimal: Muunnettu arvo. None → Decimal('0')
    
    Esimerkit:
        >>> _to_dec(100)
        Decimal('100')
        >>> _to_dec("123.45")
        Decimal('123.45')
        >>> _to_dec(None)
        Decimal('0')
    """
    return x if isinstance(x, Decimal) else Decimal(str(x if x is not None else 0))


def _icon_title(title: str) -> None:
    """
    Tulostaa koristellun otsikon laatikossa (CLI-käyttöön).
    
    Käyttää Unicode box-drawing -merkkejä luomaan visuaalisen kehyksen
    otsikon ympärille konsolitulosteeseen.
    
    Args:
        title: Näytettävä otsikkoteksti
    
    Esimerkki:
        >>> _icon_title("PÄÄVALIKKO")
        ╔════════════╗
        ║ PÄÄVALIKKO ║
        ╚════════════╝
    """
    bar = "═" * (len(title) + 2)
    print(f"\n╔{bar}╗")
    print(f"║ {title} ║")
    print(f"╚{bar}╝")
