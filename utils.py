import mysql.connector

def get_connection():
    return mysql.connector.connect(
        host="127.0.0.1",
        user="Laggorithm",
        password="CupOfLiberTea",
        database="airway666",
        autocommit=True
    )