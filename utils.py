import mysql.connector

def get_connection():
    return mysql.connector.connect(
        host="127.0.0.1",
        user="root",
        password="Salasana2025",
        database="afc_666",
        autocommit=True
    )