/**
 * app.js - Pääsovelluksen logiikka
 * Vastaa näkymien vaihdosta, pelin tilan päivityksestä ja apufunktioista
 */

// API:n base URL - Käytetään suhteellista polkua CORS-ongelmien välttämiseksi
const API_BASE = '';

// Aktiivisen tallennuksen ID (oletuksena 1)
let activeSaveId = 1;

// ============================================================
// ALOITUSNÄYTTÖ / START SCREEN FUNCTIONS
// ============================================================

/**
 * Aloittaa uuden pelin
 * Piilottaa start screenin ja näyttää pelin
 */
function showNewGameInput() {
    document.getElementById('new-game-modal')?.classList.remove('hidden');
}

async function startNewGame() {
    try {
        // Tässä voidaan myöhemmin lisätä API-kutsu uuden pelin luomiseen
        // const newGame = await apiCall('/api/game/new', { method: 'POST' });
        const playerName = document.getElementById('new-player-name').value;
        const rngSeed = document.getElementById('new-rng-seed').value;
        const difficulty = document.getElementById('new-difficulty').value;

        const payload = {
            player_name: playerName || 'Ready Player One', // Oletus
            rng_seed: rngSeed || null,
            difficulty: difficulty
         };

        const newGame = await apiCall('/api/games',{
          method: 'POST',
          body: JSON.stringify(payload)
        });

        activeSaveId = newGame.save_id;

        if (!newGame.save_id) {
          throw Error('Uuden pelin luonti epäonnistui.');
        }
        
        showGameScreen();
        showNotification('Uusi peli aloitettu!', 'success', 'TERVETULOA');
        
        // Päivitä pelin tila
        await updateGameStats();
        
        // Näytä kojelauta oletusena
        showView('dashboard');
        
    } catch (error) {
        console.error('Uuden pelin aloitus epäonnistui:', error);
        showNotification('Uuden pelin aloitus epäonnistui', 'error');
    }
}

/**
 * Hakee tallennettujen pelien listan ja näyttää valintaikkunan.
 */
async function showLoadGameList() {
    try {
        const savedGames = await apiCall('/api/games');

        const container = document.getElementById('load-game-list-container');
        if (!container) return;

        container.innerHTML = '';

        if (savedGames.length === 0) {
            container.innerHTML = '<p>Ei tallennettuja pelejä.</p>';
            return;
        }

        savedGames.forEach(game => {
            const row = document.createElement('div');
            row.className = 'game-save-row';
            row.innerHTML = `
                <span>${game.name}</span>
                <span>Päivä: ${game.day}</span>
                <span>Kassa: €${formatMoney(game.cash)}</span>
            `;
            row.addEventListener('click', () => loadGame(game.id));
            container.appendChild(row);
        });

        document.getElementById('load-screen-modal').classList.remove('hidden');

    } catch (error) {
        console.error('Virhe tallennusten haussa:', error);
        showNotification(`Tallennusten haku epäonnistui: ${error.message}`, 'error');
    }
}
/**
 * Lataa tallennetun pelin ID:n perusteella
 */
async function loadGame(gameId) {
    if (!gameId) {
      showNotification('Virhe: Pelin ID puuttuu.')
      return;
    }

    try {
        // Tässä voidaan myöhemmin lisätä tallennusten valinta-dialogi -> tehty omaksi funktioksi
        const response = await apiCall(`/api/games/${gameId}/load`, {
            method: 'POST'
        });

        activeSaveId = gameId;

        document.getElementById('load-screen-modal')?.classList.add('hidden');
        showGameScreen();
        showNotification(`Peli ${response.player_name} ladattu!`, 'success', 'TERVETULOA TAKAISIN');
        
        // Päivitä pelin tila
        await updateGameStats();
        
        // Näytä kojelauta oletusena
        showView('dashboard');
        
    } catch (error) {
        console.error('Pelin lataus epäonnistui:', error);
        showNotification('Pelin lataus epäonnistui', 'error');
    }
}

/**
 * Näyttää asetukset-dialogin
 */
function showSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.classList.remove('hidden');
        loadSettingsFromStorage();
    }
}

/**
 * Sulkee asetukset-dialogin
 */
function closeSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

/**
 * Näyttää konkurssi-modaalin (häviö-näyttö)
 * @param {Object} data - Pelin statistiikka (final_balance, peak_balance, flights, survival_days, reason)
 */
function showLoseModal(data = {}) {
    const modal = document.getElementById('lose-modal');
    if (modal) {
        // Päivitä modaalin sisältö
        const reason = data.reason || 'Kassavarat loppuivat';
        const finalBalance = data.final_balance !== undefined ? data.final_balance : '-150000';
        const peakBalance = data.peak_balance !== undefined ? data.peak_balance : '450000';
        const flights = data.flights !== undefined ? data.flights : '342';
        const survivalDays = data.survival_days !== undefined ? data.survival_days : '89 päivää';
        
        document.getElementById('lose-reason').textContent = reason;
        document.getElementById('lose-final-balance').textContent = `€${formatMoney(finalBalance)}`;
        document.getElementById('lose-peak-balance').textContent = `€${formatMoney(peakBalance)}`;
        document.getElementById('lose-flights').textContent = flights;
        document.getElementById('lose-survival-days').textContent = survivalDays;
        
        modal.classList.remove('hidden');
    }
}

/**
 * Sulkee konkurssi-modaalin ja palaa aloitusnäyttöön
 */
function closeLoseModal() {
    const modal = document.getElementById('lose-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    
    // Palaa aloitusnäyttöön
    exitGame();
}

/**
 * Näyttää voitto-modaalin (voitto-näyttö)
 * @param {Object} data - Pelin statistiikka (final_balance, flights, total_income, days_played, achievement_text, total_cargo, total_distance, fleet_size, total_hours, total_co2)
 */
function showWinModal(data = {}) {
    const modal = document.getElementById('win-modal');
    if (modal) {
        // Päivitä modaalin sisältö
        const finalBalance = data.final_balance !== undefined ? data.final_balance : '2500000';
        const flights = data.flights !== undefined ? data.flights : '1247';
        const totalIncome = data.total_income !== undefined ? data.total_income : '8950000';
        const daysPlayed = data.days_played !== undefined ? data.days_played : '365';
        const achievementText = data.achievement_text || '"TAIVAIDEN HERRA" - Omista 10+ konetta ja ansaitse €2M';
        
        // Uudet kentät
        const totalCargo = data.total_cargo_kg !== undefined ? data.total_cargo_kg : '-';
        const totalDistance = data.total_distance_km !== undefined ? data.total_distance_km : '-';
        const fleetSize = data.fleet_size !== undefined ? data.fleet_size : '-';
        const totalHours = data.total_hours !== undefined ? data.total_hours : '-';
        const totalCo2 = data.total_co2_kg !== undefined ? data.total_co2_kg : '-';

        document.getElementById('win-final-balance').textContent = `€${formatMoney(finalBalance)}`;
        document.getElementById('win-flights').textContent = flights;
        document.getElementById('win-total-income').textContent = `€${formatMoney(totalIncome)}`;
        document.getElementById('win-days-played').textContent = daysPlayed;
        document.getElementById('win-achievement-text').textContent = achievementText;
        
        // Päivitä uudet kentät jos elementit löytyvät
        if(document.getElementById('win-total-cargo')) document.getElementById('win-total-cargo').textContent = totalCargo.toLocaleString();
        if(document.getElementById('win-total-distance')) document.getElementById('win-total-distance').textContent = totalDistance.toLocaleString();
        if(document.getElementById('win-fleet-size')) document.getElementById('win-fleet-size').textContent = fleetSize;
        if(document.getElementById('win-total-hours')) document.getElementById('win-total-hours').textContent = totalHours.toLocaleString();
        if(document.getElementById('win-total-co2')) document.getElementById('win-total-co2').textContent = Math.round(totalCo2).toLocaleString();
        
        modal.classList.remove('hidden');
    }
}

/**
 * Sulkee voitto-modaalin ja palaa aloitusnäyttöön
 */
function closeWinModal() {
    const modal = document.getElementById('win-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    
    // Palaa aloitusnäyttöön
    exitGame();
}

/**
 * Poistuu pelistä
 * Palaa start screenille
 */
function exitGame() {
    const startScreen = document.getElementById('start-screen');
    const gameContainer = document.getElementById('game-container');
    
    // Näytä start screen fade-efektillä
    gameContainer.classList.add('hidden');
    startScreen.classList.remove('hidden');
    
    showNotification('Palattu aloitusnäyttöön', 'success', 'NÄKEMIIN');
}

/**
 * Poistuu pelistä ja tallentaa sen hetkisen tilanteen
 * Kutsutaan "Lopeta peli" -napista
 */
async function exitAndSaveGame() {
    try {
        showNotification('Tallennetaan peliä...', 'success', 'TALLENNUS');
        
        // Kutsu API:a pelin tallentamiseksi
        const saveResponse = await apiCall('/api/game/save', { method: 'POST' });
        
        console.log('Peli tallennettu:', saveResponse);
        
        // Palaa aloitusnäyttöön
        setTimeout(() => {
            exitGame();
        }, 500);
        
    } catch (error) {
        console.error('Pelin tallentaminen epäonnistui:', error);
        showNotification('Pelin tallentaminen epäonnistui', 'error');
    }
}

/**
 * Näyttää pelinäytön ja piilottaa start screenin
 */
function showGameScreen() {
    const startScreen = document.getElementById('start-screen');
    const gameContainer = document.getElementById('game-container');
    
    // Piilota start screen ja näytä peli
    startScreen.classList.add('hidden');
    gameContainer.classList.remove('hidden');
}

// ============================================================
// PÄÄSOVELLUKSEN LOGIIKKA / MAIN APPLICATION LOGIC
// ============================================================

/**
 * Näyttää ilmoituksen käyttäjälle
 * @param {string} message - Ilmoituksen teksti
 * @param {string} type - Tyyppi: 'success' tai 'error'
 * @param {string} title - Otsikko (valinnainen)
 */
function showNotification(message, type = 'success', title = '') {
    const notification = document.getElementById('notification');
    const titleEl = notification.querySelector('.notification-title');
    const messageEl = notification.querySelector('.notification-message');
    
    if (!title) {
        title = type === 'success' ? 'ONNISTUI' : 'VIRHE';
    }
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    notification.classList.remove('hidden');
    
    // Piilota automaattisesti 4 sekunnin kuluttua
    setTimeout(() => {
        notification.classList.add('hidden');
    }, 4000);
}

/**
 * Vaihtaa aktiivisen näkymän
 * @param {string} viewName - Näkymän nimi ('tasks', 'market', 'clubhouse')
 */
function showView(viewName) {
    // Piilota kaikki näkymät
    document.querySelectorAll('.view-container').forEach(view => {
        view.classList.add('hidden');
    });
    
    // Poista aktiivisuus kaikista napeista
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Näytä valittu näkymä
    const targetView = document.getElementById(`${viewName}-view`);
    if (targetView) {
        targetView.classList.remove('hidden');
        
        // Merkitse navigointipainike aktiiviseksi
        const activeBtn = document.querySelector(`.nav-btn[data-view="${viewName}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
        
        // Lataa näkymän data
        if (viewName === 'tasks') {
            loadActiveTasks();
            loadAircraftListForTasks();
        } else if (viewName === 'market') {
            showMarketTab('new');
        } else if (viewName === 'dashboard') {
            // Kojelauta: lataa tiedot
            loadDashboardData();
        } else if (viewName === 'laivasto') {
            // Laivasto: lataa lentokoneet
            loadFleetData();
        } else if (viewName === 'upgrades') {
            // Päivitykset: placeholder
        } else if (viewName === 'maintenance') {
            // Huolto: lataa huoltonäkymän tiedot
            loadMaintenanceView();
        } else if (viewName === 'clubhouse') {
            // Kerhohuone: päivitä cash-display
            updateClubhouseCash();
        } else if (viewName === 'blackjack') {
            // Blackjack: näytä pelisetup
            updateBlackjackCash();
            showBlackjackSetupView();
        } else if (viewName === 'map') {
            // Kartta: alusta kartta ja lataa lennon tiedot
            loadMapView();
        }
    }
}

/**
 * Hakee ja päivittää pelin perustilan yläpalkkiin
 */
async function updateGameStats() {
    try {
        // Lisätään aikaleima välimuistin ohittamiseksi
        const response = await fetch(`${API_BASE}/api/game?t=${new Date().getTime()}`);
        if (!response.ok) {
            throw new Error('Pelin tilan haku epäonnistui');
        }
        
        const data = await response.json();
        
        // Päivitä yläpalkin tiedot (käytä snake_case avaimia)
        document.getElementById('player-name').textContent = data.player_name || '-';
        document.getElementById('current-day').textContent = data.current_day || '1';
        document.getElementById('cash-amount').textContent = `€${formatMoney(data.cash)}`;
        document.getElementById('home-base').textContent = data.home_base || '-';

        // TARKISTA PELIN TILA (VOITTO / HÄVIÖ)
        if (data.status === 'VICTORY' || data.status === 'BANKRUPT') {
            // Hae lopputilastot ja näytä modal
            try {
                const statsResponse = await fetch(`${API_BASE}/api/game/stats`);
                if (statsResponse.ok) {
                    const stats = await statsResponse.json();
                    
                    if (data.status === 'VICTORY') {
                        showWinModal({
                            final_balance: stats.final_balance,
                            flights: stats.total_flights,
                            total_income: stats.total_income,
                            days_played: stats.current_day,
                            achievement_text: stats.achievement ? `"${stats.achievement}" - ${stats.achievement_desc}` : "Ei uusia saavutuksia."
                        });
                    } else {
                        showLoseModal({
                            reason: "Kassavarat loppuivat", // Tai muu syy, jos API palauttaa sen
                            final_balance: stats.final_balance,
                            peak_balance: stats.final_balance, // Placeholder, kunnes peak_balance on saatavilla
                            flights: stats.total_flights,
                            survival_days: `${stats.current_day} päivää`
                        });
                    }
                }
            } catch (e) {
                console.error("Lopputilastojen haku epäonnistui:", e);
            }
        }
        
    } catch (error) {
        console.error('Virhe pelin tilan haussa:', error);
        showNotification('Pelin tilan haku epäonnistui', 'error');
    }
}

/**
 * Formatoi rahamäärän oikeaan muotoon
 * API palauttaa rahat merkkijonoina (_decimal_to_string)
 * @param {string|number} amount - Rahamäärä
 * @returns {string} Formatoitu rahamäärä
 */
function formatMoney(amount) {
    if (!amount) return '0.00';
    
    // Jos on jo merkkijono, palauta sellaisenaan
    if (typeof amount === 'string') {
        return parseFloat(amount).toFixed(2);
    }
    
    // Jos on numero, formatoi
    return parseFloat(amount).toFixed(2);
}

/**
 * Yleinen API-kutsu apufunktio
 * @param {string} endpoint - API endpoint (esim. '/api/tasks')
 * @param {Object} options - Fetch options (method, body, jne.)
 * @returns {Promise<Object>} API:n vastaus JSON-muodossa
 */
async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.virhe || `HTTP ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('API-kutsu epäonnistui:', error);
        throw error;
    }
}

/**
 * Lataa kojelaudan tiedot
 * Hakee lennot, sopimukset, huollon tarpeet ja päivitykset
 */
async function loadDashboardData() {
    try {
        // Hae kaikki lentokoneet
        const aircraftResponse = await apiCall('/api/aircrafts');
        const aircrafts = aircraftResponse.aircraft || [];
        const aircraftCount = aircrafts.length;
        
        // Hae aktiiviset sopimukset
        const tasksResponse = await apiCall('/api/tasks');
        const tasks = tasksResponse.tehtavat || [];
        const contractCount = tasks.filter(task => task.status === 'IN_PROGRESS').length;
        
        // Laske koneet, jotka tarvitsevat huoltoa (kunto < 70%)
        const maintenanceCount = aircrafts.filter(aircraft => {
            const condition = aircraft.condition_percent || 0;
            return condition < 70;
        }).length;
        
        // Laske saatavilla olevat päivitykset (oletetaan että kaikilla koneilla voi olla ECO-päivitys)
        // Tämä voidaan myöhemmin korvata todellisella API:lla
        const upgradeCount = aircrafts.filter(aircraft => {
            // Tarkista, onko koneella ECO-päivitys
            return !aircraft.eco_equipped;
        }).length;
        
        // Päivitä DOM
        const fleetCountEl = document.getElementById('dashboard-fleet-count');
        const contractCountEl = document.getElementById('dashboard-contracts-count');
        const maintenanceCountEl = document.getElementById('dashboard-maintenance-count');
        const upgradeCountEl = document.getElementById('dashboard-upgrades-count');
        
        if (fleetCountEl) fleetCountEl.textContent = aircraftCount;
        if (contractCountEl) contractCountEl.textContent = contractCount;
        if (maintenanceCountEl) maintenanceCountEl.textContent = maintenanceCount;
        if (upgradeCountEl) upgradeCountEl.textContent = upgradeCount;
        
        console.log('Kojelaudan tiedot ladattu:', {
            aircraftCount,
            contractCount,
            maintenanceCount,
            upgradeCount
        });
        
        // Lataa uutisten päivän numero myös näkymään
        await loadNewsEvents();
        
    } catch (error) {
        console.error('Kojelaudan tietojen lataus epäonnistui:', error);
        // Näytä virheilmoitus käyttäjälle
        showNotification('Kojelaudan tietojen lataus epäonnistui', 'error');
    }
}

/**
 * Näyttää news-modaalin ja lataa uutiset
 */
async function showNewsModal() {
    const modal = document.getElementById('news-modal');
    if (modal) {
        modal.classList.remove('hidden');
        await loadNewsEvents();
    }
}

/**
 * Sulkee news-modaalin
 */
function closeNewsModal() {
    const modal = document.getElementById('news-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

/**
 * Lataa ja näyttää viimeisimmät news-tapahtumat
 */
async function loadNewsEvents() {
    try {
        const response = await apiCall('/api/events');
        const { current_day, events } = response;
        
        // Päivitä päivän numero news-kortissa
        const dayEl = document.getElementById('dashboard-news-day');
        if (dayEl) {
            dayEl.textContent = current_day;
        }
        
        // Näytä uutiset modaalissa
        const newsList = document.getElementById('news-list');
        if (!newsList) return;
        
        if (!events || events.length === 0) {
            newsList.innerHTML = '<div class="loading">Ei uutisia saatavilla</div>';
            return;
        }
        
        newsList.innerHTML = events.map(event => `
            <div class="news-item ${event.color}">
                <div class="news-item-content">
                    <div class="news-item-day">PÄIVÄ ${event.day}</div>
                    <div class="news-item-title">${escapeHtml(event.event_name)}</div>
                    <div class="news-item-weather">${escapeHtml(event.weather_description || '')}</div>
                    <div class="news-item-description">${escapeHtml(event.description || 'Tapahtumat pelin kulussa.')}</div>
                </div>
                <div class="news-item-badge">${event.type.toUpperCase()}</div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Uutisten lataus epäonnistui:', error);
        const newsList = document.getElementById('news-list');
        if (newsList) {
            newsList.innerHTML = '<div class="loading">Uutisten lataus epäonnistui</div>';
        }
    }
}

/**
 * Turvallisesti näyttää tekstin HTML:ssä (XSS-suojaus)
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Lataa aktiivisen näkymän tiedot uudelleen
 * Käytetään päivän kelauksien jälkeen näkymän päivittämiseen
 */
function reloadCurrentView() {
    // Etsi aktiivinen näkymä
    const activeBtn = document.querySelector('.nav-btn.active');
    if (activeBtn) {
        const viewName = activeBtn.getAttribute('data-view');
        if (viewName) {
            // Kutsu showView uudelleen samalla näkymällä
            // showView kutsuu automaattisesti oikeat lataustoiminnot
            showView(viewName);
        }
    }
}

// ============================================================
// ASETUKSET / SETTINGS FUNCTIONS
// ============================================================

/**
 * Lataa ääniasetukset localStorage:sta ja päivittää UI:n
 */
function loadSettingsFromStorage() {
    const soundToggle = document.getElementById('sound-toggle');
    const toggleSwitch = soundToggle.closest('.toggle-switch');
    
    // Lataa ääni-asetus (oletuksena true)
    const soundEnabled = localStorage.getItem('settings_sound_enabled');
    const isSoundEnabled = soundEnabled === null || soundEnabled === 'true';
    
    soundToggle.checked = isSoundEnabled;
    if (isSoundEnabled) {
        toggleSwitch.classList.add('enabled');
    } else {
        toggleSwitch.classList.remove('enabled');
    }
}

/**
 * Tallentaa ääniasetukset localStorage:iin
 */
function saveSettingsToStorage() {
    const soundToggle = document.getElementById('sound-toggle');
    localStorage.setItem('settings_sound_enabled', soundToggle.checked);
}

/**
 * Tarkistaa ovatko äänet käyttäjän asetuksissa enabled
 */
function isSoundEnabled() {
    const soundEnabled = localStorage.getItem('settings_sound_enabled');
    return soundEnabled === null || soundEnabled === 'true';
}

/**
 * Soittaa event-äänitiedoston jos äänet ovat käytössä
 * @param {string} soundFile - Äänitiedoston polku (esim. "event_arrival.mp3")
 */
function playEventSound(soundFile) {
    // Tarkistetaan onko äänet käyttäjän asetuksissa käytössä
    if (!isSoundEnabled()) {
        console.log('Äänet pois käytöstä, ei soiteta:', soundFile);
        return;
    }
    
    // Tarkistetaan että soundFile on määritetty
    if (!soundFile || soundFile.trim() === '') {
        console.warn('Sound file ei määritetty');
        return;
    }
    
    // Luodaan ja soitetaan audio
    try {
        const audio = new Audio(`/sounds/${soundFile}`);
        audio.volume = 0.7; // 70% äänenvoimakkuus
        audio.play().catch(error => {
            console.warn('Äänen soittaminen epäonnistui:', error);
        });
    } catch (error) {
        console.warn('Audio objektin luominen epäonnistui:', error);
    }
}

/**
 * Muuntaa img-tagit jotka käyttävät SVG:jä inline SVG:ksi 
 * Sallii CSS-säännöt SVG:n sisäisille elementeille
 */
async function inlineSvgImages() {
    // Hakee vain navigaation kuvakkeet, ignooraa exit-nappia
    const imgTags = document.querySelectorAll('.nav-icon[src$=".svg"]');
    
    for (const img of imgTags) {
        try {
            const response = await fetch(img.src);
            const svgText = await response.text();
            const parser = new DOMParser();
            const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
            const svgElement = svgDoc.documentElement;
            
            // Kopioi kaikki class:it ja id:t
            if (img.className) {
                svgElement.setAttribute('class', img.className);
            }
            if (img.id) {
                svgElement.setAttribute('id', img.id);
            }
            
            // Kopioi alt-tekstin title-elementtiin
            if (img.alt) {
                const titleElem = svgElement.querySelector('title');
                if (titleElem) {
                    titleElem.textContent = img.alt;
                }
            }
            
            // Korvaa img svg:llä
            img.parentNode.replaceChild(svgElement, img);
            
        } catch (error) {
            console.warn('SVG inlining epäonnistui:', error);
        }
    }
}

// Sivun lataus
document.addEventListener('DOMContentLoaded', () => {
    // Muunna img SVG:t inline SVG:ksi CSS-tuki varten
    inlineSvgImages();
    
    // Aseta toggle switch event listener
    const soundToggle = document.getElementById('sound-toggle');
    if (soundToggle) {
        soundToggle.addEventListener('change', (e) => {
            const toggleSwitch = e.target.closest('.toggle-switch');
            if (e.target.checked) {
                toggleSwitch.classList.add('enabled');
            } else {
                toggleSwitch.classList.remove('enabled');
            }
            saveSettingsToStorage();
        });
    }
    
    // Start screen näkyy automaattisesti
    // Peli ladataan vasta kun käyttäjä valitsee "Aloita Uusi Peli" tai "Lataa Peli"
    
    // Varmista että game container on piilotettu alussa
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
        gameContainer.classList.add('hidden');
    }

    // Start Screen - load game listener
    document.querySelector('.start-btn-secondary')?.addEventListener('click', showLoadGameList);

});
