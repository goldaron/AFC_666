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
    
    // Poista aktiivinen luokka navigointipainikkeista
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
        const response = await fetch(`${API_BASE}/api/game`);
        if (!response.ok) {
            throw new Error('Pelin tilan haku epäonnistui');
        }
        
        const data = await response.json();
        
        // Päivitä yläpalkin tiedot
        document.getElementById('player-name').textContent = data.playerName || '-';
        document.getElementById('current-day').textContent = data.day || '1';
        document.getElementById('cash-amount').textContent = `€${formatMoney(data.cash)}`;
        document.getElementById('home-base').textContent = data.homeBase || '-';
        
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

// Sivun lataus
document.addEventListener('DOMContentLoaded', () => {
    // Start screen näkyy automaattisesti
    // Peli ladataan vasta kun käyttäjä valitsee "Aloita Uusi Peli" tai "Lataa Peli"
    
    // Varmista että game container on piilotettu alussa
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
        gameContainer.classList.add('hidden');
    }
});
