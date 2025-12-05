# Frontend - Air Freight Company 666

## Rakenne

```
static/
├── index.html    # Pääsivu, kaikki näkymät
├── styles.css    # Tyylit (tumma teema, responsiivinen)
├── app.js        # Päälogiikka (näkymien vaihto, pelin tila, apufunktiot)
├── tasks.js      # Tehtävät-näkymä (tarjousten haku, hyväksyminen)
└── market.js     # Kauppapaikka-näkymä (uudet/käytetyt koneet)
```

## Käyttöönotto

1. **Käynnistä Flask API:**
   ```powershell
   python .\api_server.py
   ```

2. **Avaa selaimessa:**
   ```
   http://localhost:5000
   ```

## API-kutsut

Kaikki API-kutsut tehdään `apiCall()`-apufunktiolla, joka:
- Lisää automaattisesti `Content-Type: application/json`
- Käsittelee virheet yhtenäisesti
- Parsii JSON-vastauksen
- Näyttää virheet `showNotification()`-funktiolla

### Esimerkki:
```javascript
const data = await apiCall('/api/tasks');
// { tehtavat: [...] }

const result = await apiCall('/api/tasks', {
  method: 'POST',
  body: JSON.stringify({ aircraft_id: 5, offer: {...} })
});
```

## Rahamäärät

- API palauttaa rahat merkkijonoina (`_decimal_to_string`)
- Formatoi UI:ssa: `formatMoney(amount)` → `"1234.56"`
- Näytä käyttäjälle: `${formatMoney(amount)} €`
