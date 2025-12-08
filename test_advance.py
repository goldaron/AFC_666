#!/usr/bin/env python
"""
Yksinkertainen testi advance_to_next_day:lle
"""

from game_session import GameSession

# Luo sessio
session = GameSession(save_id=1)
print(f"Alustava päivä: {session.current_day}")

# Kutsu advance_to_next_day
result = session.advance_to_next_day(silent=True)
print(f"Tulos: {result}")
print(f"Result['day']: {result.get('day')}")
print(f"Session päivä jälkeen: {session.current_day}")

# Lataa tietokanta
session._refresh_save_state()
print(f"Session päivä jälkeen _refresh: {session.current_day}")
