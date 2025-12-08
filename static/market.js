/**
 * market.js - Kauppapaikan hallinta 
 * 
 * Vastaa seuraavista toiminnoista:
 * - Uusien koneiden näyttö (suodatettu tukikohdan tason mukaan)
 * - Käytettyjen koneiden markkinapaikan näyttö
 * - Koneiden ostaminen (uusi tai käytetty)
 * - Koneiden spesifikaatioiden esittäminen
 * 
 * Endpointit:
 * - GET /api/market/new → listaa uudet konemallit (tukikohdan taso rajaa saatavuuden)
 * - GET /api/market/used → listaa käytettyjen koneiden markkinat
 * - POST /api/market/buy → osta kone (uusi tai käytetty)
 * 
 * Suodatus logiikka:
 * Uudet koneet suodatetaan pelaajan tukikohdan tason perusteella:
 * - SMALL-taso → SMALL-kategorian koneet
 * - MEDIUM-taso → SMALL + MEDIUM-kategorian koneet
 * - LARGE-taso → SMALL + MEDIUM + LARGE-kategorian koneet
 * - HUGE-taso → kaikki kategoriat
 * 
 * Tämä toteutetaan API-puolella GameSession._fetch_aircraft_models_by_base_progress()-metodilla,
 * joten frontend saa jo suodatetut koneet.
 */

/**
 * Vaihtaa kauppapaikan välilehteä (Uudet / Käytetyt)
 * @param {string} tabName - Välilehden nimi: 'new' tai 'used'
 */
function showMarketTab(tabName) {
    // Piilota kaikki välilehdet
    document.querySelectorAll('.market-tab-content').forEach(tab => {
        tab.classList.add('hidden');
    });
    
    // Poista aktiivinen luokka painikkeista
    document.querySelectorAll('.market-tab-btn').forEach(btn => {
        btn.classList.remove('market-tab-btn-active');
    });
    
    // Näytä valittu välilehti ja merkitse painike aktiiviseksi
    document.getElementById(`market-${tabName}`).classList.remove('hidden');
    document.getElementById(`tab-${tabName}`).classList.add('market-tab-btn-active');
    
    // Lataa välilehden data
    if (tabName === 'new') {
        loadNewAircraft();
    } else if (tabName === 'used') {
        loadUsedAircraft();
    }
}

/**
 * Lataa uudet koneet tehtaalta
 * Noudattaa pelaajan tukikohdan tasoa (SMALL, MEDIUM, LARGE, HUGE)
 */
async function loadNewAircraft() {
    const listContainer = document.getElementById('new-aircraft-list');
    listContainer.innerHTML = '<p class="market-loading">Ladataan...</p>';
    
    try {
        const data = await apiCall('/api/market/new');
        
        if (!data.uudet_koneet || data.uudet_koneet.length === 0) {
            listContainer.innerHTML = `
                <div class="market-loading-message">
                    <p>❌ Ei uusia koneita saatavilla</p>
                    <p style="font-size: 0.9em; margin-top: 10px; color: #999;">
                        💡 Vihje: Päivitä tukikohta saadaksesi lisää koneiden malleja kauppaan!
                    </p>
                </div>
            `;
            return;
        }
        
        // Renderöi jokainen kone
        listContainer.innerHTML = '';
        data.uudet_koneet.forEach(aircraft => {
            const aircraftElement = createNewAircraftElement(aircraft);
            listContainer.appendChild(aircraftElement);
        });
        
    } catch (error) {
        console.error('Uusien koneiden lataus epäonnistui:', error);
        listContainer.innerHTML = '<p class="market-loading">❌ Koneiden lataus epäonnistui</p>';
        showNotification('Uusien koneiden lataus epäonnistui', 'error');
    }
}

/**
 * Luo HTML-elementin uudelle koneelle
 * 
 * Tämä funktio rakentaa kortin uudelle koneelle, joka näytetään markkinapaikalla.
 * Kortti sisältää koneen nimen, hinnan, lastauskapasiteetin, kantaman ja nopeuden.
 * 
 * Huom: API suodattaa koneet automaattisesti pelaajan tukikohdan tason (SMALL..HUGE) mukaan.
 * Näkyvillä ovat vain ne koneet, joiden kategoria vastaa tukikohdan maksimi-tasoon.
 * 
 * @param {Object} aircraft - Koneen tiedot API:sta
 * @returns {HTMLElement} Koneen HTML-elementti
 */
function createNewAircraftElement(aircraft) {
    const div = document.createElement('div');
    div.className = 'market-aircraft-card';
    
    // Käytetään API:sta saatua kantama-tietoa tai lasketaan se nopeuden perusteella
    const maxRangeKm = aircraft.range_km || aircraft.max_range_km || Math.round(aircraft.cruise_speed_kts * 8);
    
    div.innerHTML = `
        <!-- Otsikko ja hinta -->
        <div class="market-aircraft-header">
            <div class="market-aircraft-name">
                <h3>${aircraft.manufacturer} ${aircraft.model_name}</h3>
                <div class="market-aircraft-price">€${formatMoney(aircraft.purchase_price)}</div>
            </div>
            <div class="market-aircraft-icon">✈️</div>
        </div>
        
        <!-- Spesifikaatiot -->
        <div class="market-aircraft-specs">
            <div class="market-spec-item">
                <div class="market-spec-label">
                    <svg viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="6" width="12" height="8" rx="1"/></svg>
                    <span>LASTAUS</span>
                </div>
                <div class="market-spec-value">${aircraft.base_cargo_kg} kg</div>
            </div>
            <div class="market-spec-item">
                <div class="market-spec-label">
                    <svg viewBox="0 0 16 16" fill="currentColor"><polyline points="2,12 8,4 14,12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    <span>KANTAMA</span>
                </div>
                <div class="market-spec-value">${maxRangeKm} km</div>
            </div>
            <div class="market-spec-item">
                <div class="market-spec-label">
                    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 2C4.5 2 2 4 2 8c0 4 2 6 6 6s6-2 6-6c0-4-2.5-6-6-6zm0 9c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1z"/></svg>
                    <span>NOPEUS</span>
                </div>
                <div class="market-spec-value">${aircraft.cruise_speed_kts} km/h</div>
            </div>
            <div class="market-spec-item">
                <div class="market-spec-label">SAATAVUUS</div>
                <div class="market-spec-value status-available">SAATAVILLA</div>
            </div>
        </div>
        
        <!-- Ostonappe -->
        <button class="market-button" onclick="buyNewAircraftEvent(this)" data-aircraft='${JSON.stringify(aircraft).replace(/'/g, "&apos;")}'>
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3h1v2H2V4h1V3zm9 0v12H1V3h11zm-1 11V4H2v10h9zm-3-8h3v2h-3V6zm0 3h3v2h-3V9zm0 3h3v2h-3v-2z" fill-rule="evenodd"/></svg>
            <span>OSTA KONE</span>
        </button>
    `;
    
    return div;
}

/**
 * Ostaa uuden koneen tehtaalta (tapahtumakäsittelijä)
 * @param {HTMLElement} button - Painike-elementti
 */
async function buyNewAircraftEvent(button) {
    const aircraft = JSON.parse(button.getAttribute('data-aircraft'));
    await buyNewAircraft(aircraft);
}

/**
 * Ostaa uuden koneen tehtaalta
 * 
 * Lähettää POST-pyynnön API:lle uuden koneen ostamiseksi. API tarkistaa
 * pelaajan saldon ja suorittaa oston transaktiona. Koneen ostolle asetetaan
 * pelaajan pääkenttä oletusarvoisesti.
 * 
 * @param {Object} aircraft - Ostettavan koneen tiedot (model_code, purchase_price jne.)
 */
async function buyNewAircraft(aircraft) {
    try {
        // Lähetä POST-pyyntö
        const result = await apiCall('/api/market/buy', {
            method: 'POST',
            body: JSON.stringify({
                type: 'new',
                model_code: aircraft.model_code
            })
        });
        
        // Näytä onnistumisviesti
        showNotification(result.viesti || 'Kone ostettu!', 'success');
        
        // Päivitä näkymät
        await updateGameStats();
        await loadNewAircraft();
        
    } catch (error) {
        console.error('Koneen ostaminen epäonnistui:', error);
        showNotification(error.message || 'Koneen ostaminen epäonnistui', 'error');
    }
}

/**
 * Lataa käytetyt koneet markkinapaikalta
 * 
 * Hakkee aktiiviset ilmoitukset market_aircraft-taulusta ja näyttää ne
 * taulukkomuodossa. Käytetyt koneet ovat vanhempia ja halvempia kuin uudet,
 * mutta niillä on käyttöikää ja potentiaalisia ongelmia (kunto %-yksikköinä).
 * 
 * Huom: Markkinat päivittyvät joka kerta kun pelaaja avaa markkinanäkymän.
 * Yli 10 päivää vanhat ilmoitukset poistetaan ja uusia lisätään automaattisesti.
 */
async function loadUsedAircraft() {
    const listContainer = document.getElementById('used-aircraft-list');
    listContainer.innerHTML = '<tr><td colspan="8" class="market-table-loading">Ladataan...</td></tr>';
    
    try {
        const data = await apiCall('/api/market/used');
        
        if (!data.kaytetyt_koneet || data.kaytetyt_koneet.length === 0) {
            listContainer.innerHTML = '<tr><td colspan="8" class="market-table-loading">Ei käytettyjä koneita myynnissä.</td></tr>';
            return;
        }
        
        // Renderöi jokainen kone riviksi
        listContainer.innerHTML = '';
        data.kaytetyt_koneet.forEach(aircraft => {
            const row = createUsedAircraftRow(aircraft);
            listContainer.appendChild(row);
        });
        
    } catch (error) {
        console.error('Käytettyjen koneiden lataus epäonnistui:', error);
        listContainer.innerHTML = '<tr><td colspan="8" class="market-table-loading">❌ Koneiden lataus epäonnistui</td></tr>';
        showNotification('Käytettyjen koneiden lataus epäonnistui', 'error');
    }
}

/**
 * Luo HTML-rivin käytetylle koneelle
 * 
 * Rakentaa taulukon rivin käytetylle koneelle, joka näyttää:
 * - Market ID (ilmoitustunnus)
 * - Koneen mallinimi
 * - Hinta (väri-koodattu käytetyn hinnan mukaan)
 * - Kunto % (väri-koodattu: punainen <65%, keltainen <75%, vihreä)
 * - Lennon tunnit
 * - Ikä vuosina
 * - Myyjän huomiot
 * - Osta-painike
 * 
 * @param {Object} aircraft - Koneen tiedot API:sta
 * @returns {HTMLTableRowElement} Rivin HTML-elementti
 */
function createUsedAircraftRow(aircraft) {
    const tr = document.createElement('tr');
    tr.className = 'market-table-row';
    
    // Lasketaan kunnon prosentti ja väri
    const conditionPercent = aircraft.condition_percent || 100;
    let conditionColor = '#05df72'; // vihreä (hyvä)
    let conditionBar = Math.min(conditionPercent, 100);
    
    if (conditionPercent <= 65) {
        conditionColor = '#fb2c36'; // punainen (huono)
    } else if (conditionPercent <= 75) {
        conditionColor = '#f0b100'; // keltainen (keskitaso)
    }
    
    // Lasketaan ikä vuosina (yleinen päivämäärä vai aircraft_age_days?)
    const ageYears = aircraft.age_years || Math.floor((aircraft.aircraft_age_days || 0) / 365);
    const hoursFlown = aircraft.hours_flown || aircraft.total_flight_hours || aircraft.hours || 0;
    const notes = aircraft.notes || aircraft.description || 'Hyvä kunto';
    
    tr.innerHTML = `
        <td class="market-table-cell market-table-id">${aircraft.market_id || 'U-?'}</td>
        <td class="market-table-cell market-table-model">${aircraft.model_name || 'Tuntematon'}</td>
        <td class="market-table-cell market-table-price">€${formatMoney(aircraft.purchase_price || 0)}</td>
        <td class="market-table-cell market-table-condition">
            <div class="market-condition-bar-wrapper">
                <div class="market-condition-bar-bg">
                    <div class="market-condition-bar-fill" style="width: ${conditionBar}%; background-color: ${conditionColor};"></div>
                </div>
                <span class="market-condition-text" style="color: ${conditionColor};">${conditionPercent}%</span>
            </div>
        </td>
        <td class="market-table-cell market-table-hours">${formatNumberWithSeparators(hoursFlown)} TUN</td>
        <td class="market-table-cell market-table-age">${ageYears} V</td>
        <td class="market-table-cell market-table-notes">${notes}</td>
        <td class="market-table-cell market-table-actions">
            <button class="market-buy-btn" onclick="buyUsedAircraftEvent(this)" data-aircraft='${JSON.stringify(aircraft).replace(/'/g, "&apos;")}'>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 1c-1.1 0-2 .9-2 2v2H3c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1h10c.55 0 1-.45 1-1v-8c0-.55-.45-1-1-1h-3V3c0-1.1-.9-2-2-2zm0 1c.55 0 1 .45 1 1v2H7V3c0-.55.45-1 1-1z"/></svg>
                <span>OSTA</span>
            </button>
        </td>
    `;
    
    return tr;
}

/**
 * Ostaa käytetyn koneen markkinapaikalta (tapahtumakäsittelijä)
 * @param {HTMLElement} button - Painike-elementti
 */
async function buyUsedAircraftEvent(button) {
    const aircraft = JSON.parse(button.getAttribute('data-aircraft'));
    await buyUsedAircraft(aircraft);
}

/**
 * Ostaa käytetyn koneen markkinapaikalta
 * 
 * Lähettää POST-pyynnön API:lle käytetyn koneen ostamiseksi. API tarkistaa
 * pelaajan saldon ja suorittaa oston transaktiona. Koneen ostolle asetetaan
 * pelaajan pääkenttä oletusarvoisesti.
 * 
 * @param {Object} aircraft - Ostettavan koneen tiedot (market_id, purchase_price jne.)
 */
async function buyUsedAircraft(aircraft) {
    try {
        // Lähetä POST-pyyntö
        const result = await apiCall('/api/market/buy', {
            method: 'POST',
            body: JSON.stringify({
                type: 'used',
                market_id: aircraft.market_id
            })
        });
        
        // Näytä onnistumisviesti
        showNotification(result.viesti || 'Kone ostettu!', 'success');
        
        // Päivitä näkymät
        await updateGameStats();
        await loadUsedAircraft();
        
    } catch (error) {
        console.error('Koneen ostaminen epäonnistui:', error);
        showNotification(error.message || 'Koneen ostaminen epäonnistui', 'error');
    }
}

/**
 * Muotoilee numeron välilyönnein tuhattain erottimiksi
 * @param {number} num - Muotoiltava numero
 * @returns {string} Muotoiltu numero
 */
function formatNumberWithSeparators(num) {
    if (!num) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
