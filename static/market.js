/**
 * market.js - Kauppapaikan hallinta (Developer 4)
 * Vastaa uusien ja käytettyjen koneiden listaamisesta sekä ostamisesta
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
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Näytä valittu välilehti ja merkitse painike aktiiviseksi
    document.getElementById(`market-${tabName}`).classList.remove('hidden');
    document.getElementById(`tab-${tabName}`).classList.add('active');
    
    // Lataa välilehden data
    if (tabName === 'new') {
        loadNewAircraft();
    } else if (tabName === 'used') {
        loadUsedAircraft();
    }
}

/**
 * Lataa uudet koneet tehtaalta
 */
async function loadNewAircraft() {
    const listContainer = document.getElementById('new-aircraft-list');
    listContainer.innerHTML = '<p class="loading">Ladataan...</p>';
    
    try {
        const data = await apiCall('/api/market/new');
        
        if (!data.uudet_koneet || data.uudet_koneet.length === 0) {
            listContainer.innerHTML = '<p class="info">Ei uusia koneita myynnissä.</p>';
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
        listContainer.innerHTML = '<p class="error-msg">❌ Koneiden lataus epäonnistui</p>';
        showNotification('Uusien koneiden lataus epäonnistui', 'error');
    }
}

/**
 * Luo HTML-elementin uudelle koneelle
 * @param {Object} aircraft - Koneen tiedot API:sta
 * @returns {HTMLElement} Koneen HTML-elementti
 */
function createNewAircraftElement(aircraft) {
    const div = document.createElement('div');
    div.className = 'aircraft-item';
    
    // Otsikko
    const header = document.createElement('div');
    header.className = 'aircraft-item-header';
    header.innerHTML = `
        <h4>🏭 ${aircraft.manufacturer} ${aircraft.model_name}</h4>
        <span class="price">💶 ${formatMoney(aircraft.purchase_price)} €</span>
    `;
    
    // Koneen tiedot
    const details = document.createElement('div');
    details.className = 'aircraft-details';
    details.innerHTML = `
        <span>🔖 Malli: ${aircraft.model_code}</span>
        <span>📦 Kapasiteetti: ${aircraft.base_cargo_kg} kg</span>
        <span>🧭 Nopeus: ${aircraft.cruise_speed_kts} kts</span>
        <span>♻️ Eco-kerroin: x${parseFloat(aircraft.eco_fee_multiplier).toFixed(2)}</span>
    `;
    
    // Ostopainike
    const buyBtn = document.createElement('button');
    buyBtn.className = 'btn';
    buyBtn.textContent = '🛒 Osta kone';
    buyBtn.onclick = () => buyNewAircraft(aircraft);
    
    div.appendChild(header);
    div.appendChild(details);
    div.appendChild(buyBtn);
    
    return div;
}

/**
 * Ostaa uuden koneen tehtaalta
 * @param {Object} aircraft - Ostettavan koneen tiedot
 */
async function buyNewAircraft(aircraft) {
    try {
        // Vahvistus
        const confirmed = confirm(
            `Ostetaanko uusi kone:\n` +
            `Malli: ${aircraft.manufacturer} ${aircraft.model_name}\n` +
            `Hinta: ${formatMoney(aircraft.purchase_price)} €\n` +
            `Kapasiteetti: ${aircraft.base_cargo_kg} kg`
        );
        
        if (!confirmed) return;
        
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
 */
async function loadUsedAircraft() {
    const listContainer = document.getElementById('used-aircraft-list');
    listContainer.innerHTML = '<p class="loading">Ladataan...</p>';
    
    try {
        const data = await apiCall('/api/market/used');
        
        if (!data.kaytetyt_koneet || data.kaytetyt_koneet.length === 0) {
            listContainer.innerHTML = '<p class="info">Ei käytettyjä koneita myynnissä.</p>';
            return;
        }
        
        // Renderöi jokainen kone
        listContainer.innerHTML = '';
        data.kaytetyt_koneet.forEach(aircraft => {
            const aircraftElement = createUsedAircraftElement(aircraft);
            listContainer.appendChild(aircraftElement);
        });
        
    } catch (error) {
        console.error('Käytettyjen koneiden lataus epäonnistui:', error);
        listContainer.innerHTML = '<p class="error-msg">❌ Koneiden lataus epäonnistui</p>';
        showNotification('Käytettyjen koneiden lataus epäonnistui', 'error');
    }
}

/**
 * Luo HTML-elementin käytetylle koneelle
 * @param {Object} aircraft - Koneen tiedot API:sta
 * @returns {HTMLElement} Koneen HTML-elementti
 */
function createUsedAircraftElement(aircraft) {
    const div = document.createElement('div');
    div.className = 'aircraft-item';
    
    // Otsikko
    const header = document.createElement('div');
    header.className = 'aircraft-item-header';
    header.innerHTML = `
        <h4>💸 ${aircraft.model_name}</h4>
        <span class="price">💶 ${formatMoney(aircraft.purchase_price)} €</span>
    `;
    
    // Koneen tiedot
    const details = document.createElement('div');
    details.className = 'aircraft-details';
    details.innerHTML = `
        <span>🔖 Malli: ${aircraft.model_code}</span>
        <span>🔧 Kunto: ${aircraft.condition_percent}%</span>
        <span>⏱️ Lentotunnit: ${aircraft.hours_flown} h</span>
        <span>📅 Listattu: Päivä ${aircraft.listed_day}</span>
    `;
    
    // Ostopainike
    const buyBtn = document.createElement('button');
    buyBtn.className = 'btn';
    buyBtn.textContent = '🛒 Osta kone';
    buyBtn.onclick = () => buyUsedAircraft(aircraft);
    
    div.appendChild(header);
    div.appendChild(details);
    div.appendChild(buyBtn);
    
    return div;
}

/**
 * Ostaa käytetyn koneen markkinapaikalta
 * @param {Object} aircraft - Ostettavan koneen tiedot
 */
async function buyUsedAircraft(aircraft) {
    try {
        // Vahvistus
        const confirmed = confirm(
            `Ostetaanko käytetty kone:\n` +
            `Malli: ${aircraft.model_name}\n` +
            `Hinta: ${formatMoney(aircraft.purchase_price)} €\n` +
            `Kunto: ${aircraft.condition_percent}%\n` +
            `Lentotunnit: ${aircraft.hours_flown} h`
        );
        
        if (!confirmed) return;
        
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
