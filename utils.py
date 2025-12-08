import mysql.connector

def get_connection():
    return mysql.connector.connect(
        host="127.0.0.1",
        user="miikka",
        password="1234",
        database="lentopeli",
        autocommit=True
    )