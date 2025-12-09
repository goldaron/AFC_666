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
async function startNewGame() {
    try {
        // Tässä voidaan myöhemmin lisätä API-kutsu uuden pelin luomiseen
        // const newGame = await apiCall('/api/game/new', { method: 'POST' });
        
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
 * Lataa tallennetun pelin
 * Näyttää load-dialogin tai lataa suoraan
 */
async function loadGame() {
    try {
        // Tässä voidaan myöhemmin lisätä tallennusten valinta-dialogi
        // Toistaiseksi ladataan oletustallennus
        
        showGameScreen();
        showNotification('Peli ladattu!', 'success', 'TERVETULOA TAKAISIN');
        
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
    // TODO: Implementoi asetukset-dialogi
    showNotification('Asetukset tulossa pian!', 'success', 'ASETUKSET');
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
        
    } catch (error) {
        console.error('Kojelaudan tietojen lataus epäonnistui:', error);
        // Näytä virheilmoitus käyttäjälle
        showNotification('Kojelaudan tietojen lataus epäonnistui', 'error');
    }
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
    
    // Start screen näkyy automaattisesti
    // Peli ladataan vasta kun käyttäjä valitsee "Aloita Uusi Peli" tai "Lataa Peli"
    
    // Varmista että game container on piilotettu alussa
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
        gameContainer.classList.add('hidden');
    }
});
