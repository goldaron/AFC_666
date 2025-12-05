/**
 * tasks.js - Tehtävien hallinta (Developer 4 / Kehittäjä 4)
 * 
 * Vastaa seuraavista toiminnoista:
 * - Aktiivisten sopimusten listaus ja päivitys
 * - Uusien lentotehtävien tarjousten haku koneelle
 * - Sopimuksen hyväksyminen ja aloittaminen
 * - Sopimuksien edistymisen seuraaminen (deadline, saapuminen)
 * 
 * Endpointit:
 * - GET /api/tasks → listaa aktiiviset sopimukset
 * - GET /api/aircrafts/{id}/task-offers → generoi tarjouksia koneelle
 * - POST /api/tasks → hyväksy uusi sopimus
 * 
 * Kommentointi: Kaikki funktiot on dokumentoitu, ja keskeinen logiikka
 * on selitetty inline-kommenteilla.
 */

/**
 * Lataa aktiiviset tehtävät ja näyttää ne taulukossa
 */
async function loadActiveTasks() {
    const listContainer = document.getElementById('active-tasks-list');
    
    try {
        const data = await apiCall('/api/tasks');
        
        if (!data.tehtavat || data.tehtavat.length === 0) {
            listContainer.innerHTML = '<tr><td colspan="10" class="empty-state">Ei aktiivisia sopimuksia</td></tr>';
            // Päivitä sopimuksien lukumäärä
            const countElement = document.getElementById('contracts-count');
            if (countElement) countElement.textContent = '0 SAATAVILLA';
            return;
        }
        
        // Tyhjennä ja renderöi taulukkorivit
        listContainer.innerHTML = '';
        data.tehtavat.forEach(task => {
            const taskRow = createTaskElement(task);
            listContainer.appendChild(taskRow);
        });
        
        // Päivitä sopimuksien lukumäärä
        const countElement = document.getElementById('contracts-count');
        if (countElement) countElement.textContent = data.tehtavat.length + ' SAATAVILLA';
        
    } catch (error) {
        console.error('Aktiivisten sopimuksien lataus epäonnistui:', error);
        listContainer.innerHTML = '<tr><td colspan="10" class="error-cell">❌ Sopimuksien lataus epäonnistui</td></tr>';
        showNotification('Sopimuksien lataus epäonnistui', 'error');
    }
}

/**
 * Luo HTML-elementin yhdelle tehtävälle (taulukkorivi)
 * @param {Object} task - Tehtävän tiedot API:sta
 * @returns {HTMLElement} Tehtävän taulukkorivi (<tr>)
 */
function createTaskElement(task) {
    const tr = document.createElement('tr');
    tr.className = 'contract-row';
    
    // Määrittele vaikeustaso - API ei palauta difficulty, joten arvioidaan reward-perusteella
    const difficultyClass = getTaskDifficulty(task.reward, task.penalty);
    const difficultyText = getDifficultyBadge(difficultyClass);
    
    // Hae alkuperä- ja määränpääkenttä tai käytä oletusarvoja
    const origin = task.origin || 'UNK';
    const destination = task.destination || '-';
    const payloadKg = task.payloadKg || 0;
    const distanceKm = task.distance_km || 0;
    const deadlineDays = task.deadlineDay || '-';
    
    tr.innerHTML = `
        <td class="col-id">${task.contractId || '-'}</td>
        <td class="col-origin">${origin}</td>
        <td class="col-destination">${destination}</td>
        <td class="col-payload">${formatNumber(payloadKg)} KG</td>
        <td class="col-distance">${formatNumber(distanceKm)} KM</td>
        <td class="col-reward">+${formatMoney(task.reward)}</td>
        <td class="col-penalty">-${formatMoney(task.penalty)}</td>
        <td class="col-deadline">
            <div class="deadline-info">
                <span class="deadline-icon">🕒</span>
                <span>${deadlineDays}H</span>
            </div>
        </td>
        <td class="col-difficulty">
            <span class="difficulty-badge difficulty-${difficultyClass}">${difficultyText}</span>
        </td>
        <td class="col-actions">
            <button class="btn-accept" onclick="acceptTask('${task.contractId}')">📋 ACCEPT</button>
        </td>
    `;
    
    return tr;
}

/**
 * Määrittää vaikeustason reward/penalty-perusteella
 * @param {number} reward - Palkkio
 * @param {number} penalty - Sakko
 * @returns {string} Vaikeustaso (easy, medium, hard)
 */
function getTaskDifficulty(reward, penalty) {
    const rewardNum = typeof reward === 'string' ? parseInt(reward) : reward;
    const penaltyNum = typeof penalty === 'string' ? parseInt(penalty) : penalty;
    
    // Yksinkertainen heuristiikka: suurempi palkki ja sakko = vaikeampi tehtävä
    if (rewardNum > 200000) return 'hard';
    if (rewardNum > 100000) return 'medium';
    return 'easy';
}

/**
 * Palauttaa vaikeusastovälilehden teksti ja väri
 * @param {string} difficulty - Vaikeustaso (easy, medium, hard)
 * @returns {string} Badge-teksti pisteillä
 */
function getDifficultyBadge(difficulty) {
    const badgeMap = {
        'easy': '● EASY',
        'medium': '●● MEDIUM',
        'hard': '●●● HARD'
    };
    return badgeMap[difficulty.toLowerCase()] || '●● MEDIUM';
}

/**
 * Muotoilee rahan lyhyelle näytölle
 * @param {number} amount - Rahasumma
 * @returns {string} Muotoiltu rahasumma
 */
function formatMoneyCompact(amount) {
    if (amount >= 1000000) {
        return (amount / 1000000).toFixed(1) + 'M';
    } else if (amount >= 1000) {
        return (amount / 1000).toFixed(0) + 'K';
    }
    return '$' + amount;
}

/**
 * Muotoilee numeroiden välilyönnein
 * @param {number} num - Numero
 * @returns {string} Välilyönnein muotoiltu numero
 */
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Lataa koneiden listan tarjousten valintaa varten
 * 
 * Hakee kaikki pelaajan koneet API:sta ja näyttää vain IDLE-tilassa olevia koneita.
 * IDLE-kone on vapaa ja voi aloittaa uuden tehtävän. BUSY-koneet ovat jo lennolla.
 * 
 * Kutsutaan kun tehtävä-näkymä alustetaan tai päivitetään.
 * Näytetään koneen rekisteri, malli ja nykyinen sijainti.
 */
async function loadAircraftListForTasks() {
    const select = document.getElementById('task-aircraft-select');
    if (!select) return; // Ei ole valintaa näkymällä
    
    select.innerHTML = '<option value="">-- Valitse kone --</option>';
    
    try {
        const data = await apiCall('/api/aircrafts');
        
        if (!data || !data.aircrafts || data.aircrafts.length === 0) {
            select.innerHTML = '<option value="">Ei vapaita koneita</option>';
            return;
        }
        
        // Lisää vain IDLE-tilassa olevat koneet
        const idleAircraft = data.aircrafts.filter(aircraft => aircraft.status === 'IDLE');
        
        if (idleAircraft.length === 0) {
            select.innerHTML = '<option value="">Ei vapaita koneita (kaikki BUSY)</option>';
            return;
        }
        
        idleAircraft.forEach(aircraft => {
            const option = document.createElement('option');
            option.value = aircraft.aircraft_id;
            const displayName = `${aircraft.registration} - ${aircraft.model_name || 'Tuntematon'} (${aircraft.current_airport_ident || '-'})`;
            option.textContent = displayName;
            select.appendChild(option);
        });
        
        // Lisää muutoskuuntelija
        select.onchange = loadTaskOffersForAircraft;
        
    } catch (error) {
        console.error('Koneiden lataus epäonnistui:', error);
        select.innerHTML = '<option value="">❌ Lataus epäonnistui</option>';
        showNotification('Koneiden lataus epäonnistui', 'error');
    }
}

/**
 * Lataa tehtävätarjoukset valitulle koneelle
 * 
 * Kutsutaan kun käyttäjä valitsee koneen dropdown-listasta.
 * Hakkee API:sta 5 satunnaista tehtävätarjousta, jotka ovat sovelias kyseiselle koneelle.
 * Tarjousten hinta ja vaikeusaste lasketaan koneen kunnon ja muiden tekijöiden perusteella.
 * 
 * Näyttää tarjoukset taulukossa, josta käyttäjä voi valita yhden ja hyväksyä sen.
 */
async function loadTaskOffersForAircraft() {
    const select = document.getElementById('task-aircraft-select');
    const offersContainer = document.getElementById('task-offers-list');
    
    if (!select || !offersContainer) return;
    
    const aircraftId = select.value;
    
    if (!aircraftId) {
        offersContainer.innerHTML = '<p class="info">Valitse ensin kone yllä olevasta listasta.</p>';
        return;
    }
    
    offersContainer.innerHTML = '<p class="loading">Ladataan tarjouksia...</p>';
    
    try {
        const data = await apiCall(`/api/aircrafts/${aircraftId}/task-offers`);
        
        if (!data || !data.offers || data.offers.length === 0) {
            offersContainer.innerHTML = '<p class="info">Ei uusia tarjouksia saatavilla tälle koneelle.</p>';
            return;
        }
        
        // Renderöi tarjoukset
        offersContainer.innerHTML = '';
        const offersGrid = document.createElement('div');
        offersGrid.className = 'offers-grid';
        
        data.offers.forEach(offer => {
            const offerCard = createOfferCard(offer, parseInt(aircraftId));
            offersGrid.appendChild(offerCard);
        });
        
        offersContainer.appendChild(offersGrid);
        
    } catch (error) {
        console.error('Tarjousten lataus epäonnistui:', error);
        offersContainer.innerHTML = '<p class="error-msg">❌ Tarjousten lataus epäonnistui</p>';
        showNotification('Tarjousten lataus epäonnistui', 'error');
    }
}

/**
 * Luo offer-kortin (tarjouskortti)
 * @param {Object} offer - Tarjouksen tiedot
 * @param {number} aircraftId - Koneen ID
 * @returns {HTMLElement} Tarjouskortin HTML-elementti
 */
function createOfferCard(offer, aircraftId) {
    const card = document.createElement('div');
    card.className = 'offer-card';
    
    // Määrittele vaikeustaso reward-perusteella
    const rewardNum = typeof offer.reward === 'string' ? parseInt(offer.reward) : offer.reward;
    const difficultyClass = rewardNum > 200000 ? 'hard' : (rewardNum > 100000 ? 'medium' : 'easy');
    const difficultyText = getDifficultyBadge(difficultyClass);
    
    card.innerHTML = `
        <div class="offer-header">
            <h4>${offer.dest_ident} - ${offer.dest_name || 'Tuntematon'}</h4>
        </div>
        <div class="offer-body">
            <div class="offer-row">
                <span class="label">📦 Rahti:</span>
                <span class="value">${formatNumber(offer.payload_kg)} kg</span>
            </div>
            <div class="offer-row">
                <span class="label">📏 Etäisyys:</span>
                <span class="value">${formatNumber(offer.distance_km)} km</span>
            </div>
            <div class="offer-row">
                <span class="label">🔁 Reissuja:</span>
                <span class="value">${offer.trips}</span>
            </div>
            <div class="offer-row">
                <span class="label">🕒 Kesto:</span>
                <span class="value">${offer.total_days} pv</span>
            </div>
            <div class="offer-row reward">
                <span class="label">💰 Palkkio:</span>
                <span class="value">+${formatMoney(offer.reward)}</span>
            </div>
            <div class="offer-row penalty">
                <span class="label">❗ Sakko:</span>
                <span class="value">-${formatMoney(offer.penalty)}</span>
            </div>
            <div class="offer-row">
                <span class="label">📅 Deadline:</span>
                <span class="value">${offer.deadline}h</span>
            </div>
            <div class="offer-row difficulty">
                <span class="difficulty-badge difficulty-${difficultyClass}">${difficultyText}</span>
            </div>
        </div>
        <div class="offer-actions">
            <button class="btn-accept" onclick="acceptNewTask(${aircraftId}, this)">
                ✅ Hyväksy tehtävä
            </button>
        </div>
    `;
    
    return card;
}

/**
 * Hyväksyy sopimuksen tai näyttää virheen
 * @param {string} contractId - Sopimuksen ID
 */
/**
 * Hyväksy uusi tehtävä - lähettää POST /api/tasks
 * @param {number} aircraftId - Koneen ID
 * @param {HTMLElement} button - Hyväksymispainike (disabloidaan ladatessa)
 */
async function acceptNewTask(aircraftId, button) {
    button.disabled = true;
    button.textContent = '⏳ Hyväksytään...';
    
    try {
        // Etsi tarjous button:n parent-kortin datasta
        const card = button.closest('.offer-card');
        if (!card) {
            showNotification('Kortin tiedot menetettiin', 'error');
            button.disabled = false;
            button.textContent = '✅ Hyväksy tehtävä';
            return;
        }
        
        // Nouda tarjouksen tiedot kortin elementeistä
        // Tämä on hieman kinkkinen tapa, mutta vältetään datan duplikointia
        const offerData = extractOfferDataFromCard(card, aircraftId);
        
        const payload = {
            aircraft_id: aircraftId,
            offer: offerData
        };
        
        const response = await apiCall('/api/tasks', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        
        if (response.error) {
            throw new Error(response.error);
        }
        
        // Onnistui
        showNotification(`✅ Tehtävä hyväksytty! Sopimus: ${response.contractId}`, 'success');
        
        // Päivitä aktiiviset tehtävät
        await loadActiveTasks();
        
        // Tyhjennä tarjoukset ja koneen valinta
        const select = document.getElementById('task-aircraft-select');
        if (select) {
            select.value = '';
            const offersContainer = document.getElementById('task-offers-list');
            if (offersContainer) {
                offersContainer.innerHTML = '<p class="info">Valitse kone yllä olevasta listasta uusien tarjousten näkemiseksi.</p>';
            }
        }
        
    } catch (error) {
        console.error('Tehtävän hyväksyminen epäonnistui:', error);
        showNotification(`❌ Tehtävän hyväksyminen epäonnistui: ${error.message}`, 'error');
        button.disabled = false;
        button.textContent = '✅ Hyväksy tehtävä';
    }
}

/**
 * Pura tarjouksen tiedot kortin HTML-sisällöstä
 * Käytetään kun offer-objektia ei ole tallessa JavaScriptissä
 * @param {HTMLElement} card - Tarjouskortti
 * @param {number} aircraftId - Koneen ID
 * @returns {Object} Tarjouksen tiedot
 */
function extractOfferDataFromCard(card, aircraftId) {
    // Yksinkertainen parsinta: etsi teksti-arvot kortin riveistä
    const rows = Array.from(card.querySelectorAll('.offer-row'));
    const data = {
        dest_ident: card.querySelector('.offer-header h4').textContent.split(' - ')[0].trim(),
        dest_name: card.querySelector('.offer-header h4').textContent.split(' - ')[1] || 'Tuntematon',
        payload_kg: 0,
        distance_km: 0,
        trips: 0,
        total_days: 0,
        reward: 0,
        penalty: 0,
        deadline: 0
    };
    
    // Parsitaan kukin rivi säännöllisesti
    rows.forEach(row => {
        const label = row.querySelector('.label').textContent.toLowerCase();
        const valueText = row.querySelector('.value').textContent.trim();
        
        if (label.includes('rahti')) {
            data.payload_kg = parseInt(valueText.replace(/[^\d]/g, '')) || 0;
        } else if (label.includes('etäisyys')) {
            data.distance_km = parseInt(valueText.replace(/[^\d]/g, '')) || 0;
        } else if (label.includes('reissuja')) {
            data.trips = parseInt(valueText.replace(/[^\d]/g, '')) || 0;
        } else if (label.includes('kesto')) {
            data.total_days = parseInt(valueText.replace(/[^\d]/g, '')) || 0;
        } else if (label.includes('palkkio')) {
            data.reward = parseInt(valueText.replace(/[^\d]/g, '')) || 0;
        } else if (label.includes('sakko')) {
            data.penalty = parseInt(valueText.replace(/[^\d]/g, '')) || 0;
        } else if (label.includes('deadline')) {
            data.deadline = parseInt(valueText.replace(/[^\d]/g, '')) || 0;
        }
    });
    
    return data;
}

/**
 * Hyväksy aktiivisen sopimuksen (taulukosta)
 * Huomio: aktiiviset sopimukset on jo hyväksytty
 * ACCEPT-painike on taulukossa vain reference, ei ole todellista funktionaalisuutta
 * @param {string} contractId - Sopimuksen ID
 */
async function acceptTask(contractId) {
    try {
        showNotification(`ℹ️ Sopimus ${contractId} on jo aktiivinen. Tämä painike on UI-placeholder.`, 'info');
        
    } catch (error) {
        console.error('Toiminnot epäonnistui:', error);
        showNotification('Toiminnot epäonnistui', 'error');
    }
}
