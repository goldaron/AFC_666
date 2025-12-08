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

// Tallennetaan nykyiset tarjoukset muistiin, jotta niitä ei tarvitse parsia HTML:stä
let currentOffers = [];

/**
 * Lataa aktiiviset tehtävät ja näyttää ne taulukossa
 */
async function loadActiveTasks() {
    const listContainer = document.getElementById('active-tasks-list');
    
    try {
        const data = await apiCall('/api/tasks');
        
        if (!data.tehtavat || data.tehtavat.length === 0) {
            listContainer.innerHTML = '<tr><td colspan="10" class="empty-state">Ei aktiivisia sopimuksia</td></tr>';
            // Päivitä sopimuksien lukumäärä ja tilastot
            const countElement = document.getElementById('available-count');
            if (countElement) countElement.textContent = '0';
            updateTaskStats([]);
            return;
        }
        
        // Tyhjennä ja renderöi taulukkorivit
        listContainer.innerHTML = '';
        data.tehtavat.forEach(task => {
            const taskRow = createTaskElement(task);
            listContainer.appendChild(taskRow);
        });
        
        // Päivitä sopimuksien lukumäärä
        const countElement = document.getElementById('available-count');
        if (countElement) countElement.textContent = data.tehtavat.length;
        
        // Päivitä tilastot (keskiarvo, etäisyys, kiireelliset)
        updateTaskStats(data.tehtavat);
        
    } catch (error) {
        console.error('Aktiivisten sopimuksien lataus epäonnistui:', error);
        listContainer.innerHTML = '<tr><td colspan="10" class="error-cell">❌ Sopimuksien lataus epäonnistui</td></tr>';
        showNotification('Sopimuksien lataus epäonnistui', 'error');
    }
}

/**
 * Päivittää tilastokortit (keskimääräinen palkkio, etäisyys, kiireelliset)
 * @param {Array} tasks - Lista tehtävistä
 */
function updateTaskStats(tasks) {
    if (!tasks || tasks.length === 0) {
        document.getElementById('avg-reward').textContent = '€0';
        document.getElementById('avg-distance').textContent = '0 KM';
        document.getElementById('urgent-count').textContent = '0';
        return;
    }
    
    // Laske keskimääräinen palkkio
    const totalReward = tasks.reduce((sum, task) => {
        const reward = typeof task.reward === 'string' ? parseInt(task.reward) : (task.reward || 0);
        return sum + reward;
    }, 0);
    const avgReward = Math.round(totalReward / tasks.length);
    
    // Laske keskimääräinen etäisyys
    const totalDistance = tasks.reduce((sum, task) => {
        const distance = typeof task.distance_km === 'string' ? parseInt(task.distance_km) : (task.distance_km || 0);
        return sum + distance;
    }, 0);
    const avgDistance = Math.round(totalDistance / tasks.length);
    
    // Laske kiireellisten määrä (deadline < 24h eli < 1 päivä)
    const urgentCount = tasks.filter(task => {
        const deadline = typeof task.deadlineDay === 'string' ? parseInt(task.deadlineDay) : (task.deadlineDay || 0);
        return deadline < 24;
    }).length;
    
    // Päivitä HTML
    document.getElementById('avg-reward').textContent = '€' + formatMoney(avgReward);
    document.getElementById('avg-distance').textContent = formatNumber(avgDistance) + ' KM';
    document.getElementById('urgent-count').textContent = urgentCount;
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
        <td class="col-status">
            <button class="btn-status" onclick="showFlightDetails('${task.contractId}')">✈️ ${getFlightStatusText(task.flight)}</button>
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
        'easy': '● HELPPO',
        'medium': '●● KESKITASO',
        'hard': '●●● VAIKEA'
    };
    return badgeMap[difficulty.toLowerCase()] || '●● KESKITASO';
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
    return '€' + amount;
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
    
    // Tyhjennetään valinta
    select.innerHTML = '<option value="">-- Valitse kone --</option>';
    select.disabled = true; // Estetään valinta latauksen ajaksi
    
    try {
        const data = await apiCall('/api/aircrafts');
        
        if (!data || !data.aircraft || data.aircraft.length === 0) {
            select.innerHTML = '<option value="">Ei omistettuja koneita</option>';
            return;
        }
        
        // Lisää vain IDLE-tilassa olevat koneet
        // Varmistetaan, että vertailu on case-insensitive ja tarkka
        const idleAircraft = data.aircraft.filter(aircraft => 
            aircraft.status && aircraft.status.toUpperCase() === 'IDLE'
        );
        
        if (idleAircraft.length === 0) {
            // Jos on koneita mutta kaikki BUSY
            const busyCount = data.aircraft.length;
            select.innerHTML = `<option value="">Ei vapaita koneita (${busyCount} lennolla/huollossa)</option>`;
            return;
        }
        
        // Lisätään vapaat koneet listaan
        idleAircraft.forEach(aircraft => {
            const option = document.createElement('option');
            option.value = aircraft.aircraft_id;
            // Näytetään: REKISTERI - MALLI (KENTTÄ) - KUNTO%
            const displayName = `${aircraft.registration} - ${aircraft.model_name || 'Tuntematon'} (${aircraft.current_airport_ident || '-'}) ${aircraft.condition_percent}%`;
            option.textContent = displayName;
            select.appendChild(option);
        });
        
        // Otetaan valinta käyttöön ja lisätään kuuntelija
        select.disabled = false;
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
            currentOffers = [];
            return;
        }
        
        // Tallennetaan tarjoukset globaaliin muuttujaan
        currentOffers = data.offers;
        
        // Renderöi tarjoukset
        offersContainer.innerHTML = '';
        const offersGrid = document.createElement('div');
        offersGrid.className = 'offers-grid';
        
        data.offers.forEach((offer, index) => {
            const offerCard = createOfferCard(offer, parseInt(aircraftId), index);
            offersGrid.appendChild(offerCard);
        });
        
        offersContainer.appendChild(offersGrid);
        
    } catch (error) {
        console.error('Tarjousten lataus epäonnistui:', error);
        offersContainer.innerHTML = `<p class="error-msg">❌ Tarjousten lataus epäonnistui: ${error.message}</p>`;
        showNotification(`Tarjousten lataus epäonnistui: ${error.message}`, 'error');
    }
}

/**
 * Luo offer-kortin (tarjouskortti)
 * @param {Object} offer - Tarjouksen tiedot
 * @param {number} aircraftId - Koneen ID
 * @param {number} offerIndex - Tarjouksen indeksi taulukossa
 * @returns {HTMLElement} Tarjouskortin HTML-elementti
 */
function createOfferCard(offer, aircraftId, offerIndex) {
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
            <button class="btn-accept" onclick="acceptNewTask(this)" data-aircraft-id="${aircraftId}" data-offer-index="${offerIndex}">
                ✅ Hyväksy tehtävä
            </button>
        </div>
    `;
    
    return card;
}

/**
 * Hyväksy uusi tehtävä - lähettää POST /api/tasks
 * @param {HTMLElement} button - Hyväksymispainike
 */
async function acceptNewTask(button) {
    const aircraftId = button.getAttribute('data-aircraft-id');
    const offerIndex = button.getAttribute('data-offer-index');
    
    if (!aircraftId || offerIndex === null) {
        showNotification('Virhe: Puuttuvat tiedot', 'error');
        return;
    }

    // Haetaan tarjous muistista indeksin perusteella
    const offerData = currentOffers[parseInt(offerIndex)];
    if (!offerData) {
        showNotification('Virhe: Tarjousta ei löytynyt muistista', 'error');
        return;
    }

    button.disabled = true;
    button.textContent = '⏳ Hyväksytään...';
    
    try {
        const payload = {
            aircraft_id: parseInt(aircraftId),
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
        currentOffers = []; // Tyhjennetään tarjoukset
        
        // Päivitä myös kojelauta ja rahatilanne
        if (typeof updateGameStats === 'function') {
            updateGameStats();
        }
        
    } catch (error) {
        console.error('Tehtävän hyväksyminen epäonnistui:', error);
        showNotification(`❌ Tehtävän hyväksyminen epäonnistui: ${error.message}`, 'error');
        button.disabled = false;
        button.textContent = '✅ Hyväksy tehtävä';
    }
}


/**
 * Palauttaa lennon tilanteen suomenkielisesti
 * @param {Object} flight - Lennon objekti (arrival_day, status, jne)
 * @returns {string} Tilanteen teksti
 */
function getFlightStatusText(flight) {
    if (!flight) {
        return "Odottaa lähtöä";
    }
    
    const status = flight.status || "UNKNOWN";
    
    switch(status) {
        case "SCHEDULED":
            return "Ajoitettu";
        case "IN_FLIGHT":
        case "ENROUTE":
            return "Reitillä";
        case "ARRIVED":
        case "ARRIVED_RTB":
            return "Saapunut";
        case "COMPLETED":
            return "Valmis";
        case "CANCELLED":
            return "Peruutettu";
        default:
            return "Reitillä";
    }
}

/**
 * Näyttää lennon tiedot modalissa tai notifikaatiossa
 * @param {string} contractId - Sopimuksen ID
 */
function showFlightDetails(contractId) {
    showNotification(`ℹ️ Sopimus ${contractId} on käynnissä. Seuraa lennon edistymistä kojelauta-näkymässä.`, 'info');
}