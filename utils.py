import mysql.connector
from mysql.connector import pooling
from contextlib import contextmanager

# Alustetaan yhteyspooli globaalisti, jotta yhteyksiä kierrätetään
# Tämä estää "Can't assign requested address" -virheet raskaassa kuormassa
db_pool = mysql.connector.pooling.MySQLConnectionPool(
    pool_name="mypool",
    pool_size=10,
    host="127.0.0.1",
    user="golda",
    password="GoldaKoodaa",
    database="airway666",
    autocommit=True
)

def get_connection():
    """Hakee tietokantayhteyden poolista ja varmistaa sen puhtauden."""
    cnx = db_pool.get_connection()
    try:
        # Varmistetaan että edellinen transaktio on päättynyt
        cnx.rollback()
    except Exception:
        pass
    return cnx


@contextmanager
def get_db_connection():
    """Konteksti-hallinnan avulla saatava tietokantayhteys (with-lausetta varten)."""
    conn = get_connection()
    try:
        yield conn
    finally:
        try:
            conn.close()
        except Exception:
            pass

# Taulu pelitapahtumien tallentamista varten
CREATE_TABLE_SAVE_EVENT_LOG = """
CREATE TABLE IF NOT EXISTS save_event_log (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    save_id INT NOT NULL,
    event_day INT DEFAULT 0,
    event_type VARCHAR(50) NOT NULL,
    payload TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (save_id) REFERENCES game_saves(save_id)
);
"""