/**
 * tasks.js - Tehtävien hallinta
 * Vastaa tehtävätarjousten hakemisesta, aktiivisten tehtävien listaamisesta
 * ja uusien tehtävien hyväksymisestä
 */

/**
 * Lataa aktiiviset tehtävät ja näyttää ne listassa
 */
async function loadActiveTasks() {
    const listContainer = document.getElementById('active-tasks-list');
    listContainer.innerHTML = '<p class="loading">Ladataan...</p>';
    
    try {
        const data = await apiCall('/api/tasks');
        
        if (!data.tehtavat || data.tehtavat.length === 0) {
            listContainer.innerHTML = '<p class="info">Ei aktiivisia tehtäviä.</p>';
            return;
        }
        
        // Renderöi jokainen tehtävä
        listContainer.innerHTML = '';
        data.tehtavat.forEach(task => {
            const taskElement = createTaskElement(task);
            listContainer.appendChild(taskElement);
        });
        
    } catch (error) {
        console.error('Aktiivisten tehtävien lataus epäonnistui:', error);
        listContainer.innerHTML = '<p class="error-msg">❌ Tehtävien lataus epäonnistui</p>';
        showNotification('Tehtävien lataus epäonnistui', 'error');
    }
}

/**
 * Luo HTML-elementin yhdelle tehtävälle
 * @param {Object} task - Tehtävän tiedot API:sta
 * @returns {HTMLElement} Tehtävän HTML-elementti
 */
function createTaskElement(task) {
    const div = document.createElement('div');
    div.className = 'task-item';
    
    // Määränpää ja kone
    const header = document.createElement('div');
    header.className = 'task-item-header';
    header.innerHTML = `
        <h4>🛫 Kohde: ${task.destination || '-'}</h4>
        <span>${task.flight.status || 'ENROUTE'}</span>
    `;
    
    // Tehtävän tiedot
    const details = document.createElement('div');
    details.className = 'task-details';
    details.innerHTML = `
        <span>✈️ Kone: ${task.aircraft || '-'}</span>
        <span>📦 Rahti: ${task.payloadKg} kg</span>
        <span>💶 Palkkio: ${formatMoney(task.reward)} €</span>
        <span>❗ Sakko: ${formatMoney(task.penalty)} €</span>
        <span>📅 Deadline: Päivä ${task.deadlineDay}</span>
        <span>🕒 Saapuu: Päivä ${task.flight.arrivalDay || '-'}</span>
    `;
    
    div.appendChild(header);
    div.appendChild(details);
    
    return div;
}

/**
 * Lataa koneiden listan tarjousten valintaa varten
 */
async function loadAircraftListForTasks() {
    const select = document.getElementById('task-aircraft-select');
    select.innerHTML = '<option value="">-- Valitse kone --</option>';
    
    try {
        const data = await apiCall('/api/aircrafts');
        
        if (!data.koneet || data.koneet.length === 0) {
            select.innerHTML = '<option value="">Ei vapaita koneita</option>';
            return;
        }
        
        // Lisää vain IDLE-tilassa olevat koneet
        data.koneet
            .filter(aircraft => aircraft.status === 'IDLE')
            .forEach(aircraft => {
                const option = document.createElement('option');
                option.value = aircraft.aircraft_id;
                option.textContent = `${aircraft.registration} - ${aircraft.model_name} (${aircraft.current_airport})`;
                select.appendChild(option);
            });
        
    } catch (error) {
        console.error('Koneiden lataus epäonnistui:', error);
        select.innerHTML = '<option value="">❌ Lataus epäonnistui</option>';
    }
}

/**
 * Lataa tehtävätarjoukset valitulle koneelle
 * Kutsutaan kun käyttäjä valitsee koneen dropdown-listasta
 */
async function loadTaskOffersForAircraft() {
    const select = document.getElementById('task-aircraft-select');
    const aircraftId = select.value;
    const offersContainer = document.getElementById('task-offers-list');
    
    if (!aircraftId) {
        offersContainer.innerHTML = '<p class="info">Valitse ensin kone yllä olevasta listasta.</p>';
        return;
    }
    
    offersContainer.innerHTML = '<p class="loading">Ladataan tarjouksia...</p>';
    
    try {
        const data = await apiCall(`/api/aircrafts/${aircraftId}/task-offers`);
        
        if (!data.offers || data.offers.length === 0) {
            offersContainer.innerHTML = '<p class="info">Ei tarjouksia saatavilla tälle koneelle.</p>';
            return;
        }
        
        // Renderöi tarjoukset
        offersContainer.innerHTML = '';
        data.offers.forEach(offer => {
            const offerElement = createOfferElement(offer, aircraftId);
            offersContainer.appendChild(offerElement);
        });
        
    } catch (error) {
        console.error('Tarjousten lataus epäonnistui:', error);
        offersContainer.innerHTML = '<p class="error-msg">❌ Tarjousten lataus epäonnistui</p>';
        showNotification('Tarjousten lataus epäonnistui', 'error');
    }
}

/**
 * Luo HTML-elementin yhdelle tarjoukselle
 * @param {Object} offer - Tarjouksen tiedot API:sta
 * @param {number} aircraftId - Koneen ID
 * @returns {HTMLElement} Tarjouksen HTML-elementti
 */
function createOfferElement(offer, aircraftId) {
    const div = document.createElement('div');
    div.className = 'offer-item';
    
    // Otsikko
    const header = document.createElement('div');
    header.className = 'offer-item-header';
    header.innerHTML = `
        <h4>🛬 ${offer.dest_ident} - ${offer.dest_name || 'Tuntematon'}</h4>
    `;
    
    // Tarjouksen tiedot
    const details = document.createElement('div');
    details.className = 'offer-details';
    details.innerHTML = `
        <span>📦 Rahti: ${offer.payload_kg} kg</span>
        <span>📏 Etäisyys: ${offer.distance_km} km</span>
        <span>🔁 Reissuja: ${offer.trips}</span>
        <span>🕒 Kesto: ${offer.total_days} pv</span>
        <span>💶 Palkkio: ${formatMoney(offer.reward)} €</span>
        <span>❗ Sakko: ${formatMoney(offer.penalty)} €</span>
        <span>📅 Deadline: Päivä ${offer.deadline}</span>
    `;
    
    // Hyväksymispainike
    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'btn';
    acceptBtn.textContent = '✅ Hyväksy tehtävä';
    acceptBtn.onclick = () => acceptTask(aircraftId, offer);
    
    div.appendChild(header);
    div.appendChild(details);
    div.appendChild(acceptBtn);
    
    return div;
}

/**
 * Hyväksyy tehtävän ja lähettää sen API:lle
 * @param {number} aircraftId - Koneen ID
 * @param {Object} offer - Tarjouksen tiedot
 */
async function acceptTask(aircraftId, offer) {
    try {
        // Vahvistus ennen lähettämistä
        const confirmed = confirm(
            `Hyväksytäänkö tehtävä:\n` +
            `Kohde: ${offer.dest_ident}\n` +
            `Rahti: ${offer.payload_kg} kg\n` +
            `Palkkio: ${formatMoney(offer.reward)} €\n` +
            `Deadline: Päivä ${offer.deadline}`
        );
        
        if (!confirmed) return;
        
        // Lähetä POST-pyyntö
        const result = await apiCall('/api/tasks', {
            method: 'POST',
            body: JSON.stringify({
                aircraft_id: aircraftId,
                offer: offer
            })
        });
        
        // Näytä onnistumisviesti
        showNotification(result.viesti || 'Tehtävä hyväksytty!', 'success');
        
        // Päivitä näkymät
        await updateGameStats();
        await loadActiveTasks();
        await loadAircraftListForTasks();
        
        // Tyhjennä tarjouslista
        document.getElementById('task-offers-list').innerHTML = 
            '<p class="info">Valitse kone nähdäksesi uudet tarjoukset.</p>';
        document.getElementById('task-aircraft-select').value = '';
        
    } catch (error) {
        console.error('Tehtävän hyväksyminen epäonnistui:', error);
        showNotification(error.message || 'Tehtävän hyväksyminen epäonnistui', 'error');
    }
}
