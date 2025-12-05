/**
 * clubhouse.js - Kerhohuoneen hallinta (Developer 4)
 * Vastaa minipelien (Coin Flip, High/Low, Slots) pelaamisesta
 */

/**
 * Päivitä cash-display kerhohuoneessa
 */
async function updateClubhouseCash() {
    try {
        // Hae pelin tila - stats sisältää cash-arvon
        // Tämä kutsutaan kun kerhohuone näytetään
        const response = await apiCall('/api/game/stats');
        const cashDisplay = document.getElementById('clubhouse-cash-display');
        if (cashDisplay && response.cash) {
            cashDisplay.textContent = formatMoney(response.cash);
        }
    } catch (error) {
        console.error('Cash-päivitys epäonnistui:', error);
    }
}

/**
 * Näytä Kruuna vai Klaava -peli modaalissa
 */
function showCoinFlipGame() {
    const modal = document.getElementById('game-modal');
    const content = modal.querySelector('.kerhohuone-game-modal-content');
    
    content.innerHTML = `
        <div class="kerhohuone-game-form">
            <h2>KRUUNA VAI KLAAVA</h2>
            <div class="kerhohuone-game-desc">Valitse kruuna tai klaava. Voita panoksesi tai menetä se.</div>
            
            <div class="kerhohuone-form-group">
                <label for="coin-flip-bet-modal">PANOS (€)</label>
                <input type="number" id="coin-flip-bet-modal" value="100" min="1" step="10" class="kerhohuone-form-input">
            </div>
            
            <div class="kerhohuone-form-buttons">
                <button class="kerhohuone-form-btn" onclick="playCoinFlip('heads')">🪙 KRUUNA</button>
                <button class="kerhohuone-form-btn" onclick="playCoinFlip('tails')">🦅 KLAAVA</button>
            </div>
            
            <div id="coin-flip-modal-result" class="kerhohuone-game-result hidden"></div>
            
            <button class="kerhohuone-form-close" onclick="closeCoinFlipGame()">SULJE</button>
        </div>
    `;
    
    modal.classList.remove('hidden');
}

/**
 * Näytä Suurempi vai Pienempi -peli modaalissa
 */
function showHighLowGame() {
    const modal = document.getElementById('game-modal');
    const content = modal.querySelector('.kerhohuone-game-modal-content');
    
    content.innerHTML = `
        <div class="kerhohuone-game-form">
            <h2>SUUREMPI VAI PIENEMPI</h2>
            <div class="kerhohuone-game-desc">Arvaa onko toinen noppa suurempi vai pienempi kuin ensimmäinen.</div>
            
            <div class="kerhohuone-form-group">
                <label for="hilo-bet-modal">PANOS (€)</label>
                <input type="number" id="hilo-bet-modal" value="100" min="1" step="10" class="kerhohuone-form-input">
            </div>
            
            <div class="kerhohuone-form-buttons">
                <button class="kerhohuone-form-btn" onclick="playHighLow('high')">🔼 SUUREMPI</button>
                <button class="kerhohuone-form-btn" onclick="playHighLow('low')">🔽 PIENEMPI</button>
            </div>
            
            <div id="hilo-modal-result" class="kerhohuone-game-result hidden"></div>
            
            <button class="kerhohuone-form-close" onclick="closeHighLowGame()">SULJE</button>
        </div>
    `;
    
    modal.classList.remove('hidden');
}

/**
 * Näytä Yksikätinen Rosvo -peli modaalissa
 */
function showSlotsGame() {
    const modal = document.getElementById('game-modal');
    const content = modal.querySelector('.kerhohuone-game-modal-content');
    
    content.innerHTML = `
        <div class="kerhohuone-game-form">
            <h2>YKSIKÄTINEN ROSVO</h2>
            <div class="kerhohuone-game-desc">Pyöräytä kiekkoja ja voita jopa 50x panos!</div>
            
            <div class="kerhohuone-form-group">
                <label for="slots-bet-modal">PANOS (€)</label>
                <input type="number" id="slots-bet-modal" value="50" min="1" step="10" class="kerhohuone-form-input">
            </div>
            
            <div class="kerhohuone-slots-display">❓ ❓ ❓</div>
            
            <div class="kerhohuone-form-buttons">
                <button class="kerhohuone-form-btn kerhohuone-form-btn-large" onclick="playSlots()">🎰 PYÖRÄYTÄ</button>
            </div>
            
            <div id="slots-modal-result" class="kerhohuone-game-result hidden"></div>
            
            <button class="kerhohuone-form-close" onclick="closeSlotsGame()">SULJE</button>
        </div>
    `;
    
    modal.classList.remove('hidden');
}

/**
 * Sulje pelin modaali
 */
function closeGameModal() {
    const modal = document.getElementById('game-modal');
    modal.classList.add('hidden');
}

function closeCoinFlipGame() { closeGameModal(); }
function closeHighLowGame() { closeGameModal(); }
function closeSlotsGame() { closeGameModal(); }

/**
 * Pelaa kolikonheittoa
 * @param {string} choice - Valinta: 'heads' (kruuna) tai 'tails' (klaava)
 */
async function playCoinFlip(choice) {
    const betInput = document.getElementById('coin-flip-bet-modal') || document.getElementById('coin-flip-bet');
    const resultContainer = document.getElementById('coin-flip-modal-result') || document.getElementById('coin-flip-result');
    const bet = parseFloat(betInput.value);
    
    if (!validateBet(bet)) return;
    
    resultContainer.innerHTML = '<p class="loading">Heitetään kolikkoa...</p>';
    resultContainer.classList.remove('hidden');
    
    try {
        const data = await apiCall('/api/clubhouse', {
            method: 'POST',
            body: JSON.stringify({
                game: 'coin_flip',
                choice: choice,
                bet: bet
            })
        });
        
        const winClass = data.voitto ? 'success-text' : 'error-text';
        const resultEmoji = data.flip === 'heads' ? '🪙 KRUUNA' : '🦅 KLAAVA';
        
        resultContainer.innerHTML = `
            <div class="kerhohuone-game-result-card">
                <h3>TULOS: ${resultEmoji}</h3>
                <p class="${winClass}">${data.viesti}</p>
                <p>Uusi saldo: ${formatMoney(data.balance)} €</p>
            </div>
        `;
        
        handleGameResult(data.voitto, data.viesti);
        await updateGameStats();
        await updateClubhouseCash();
        
    } catch (error) {
        handleGameError(error, resultContainer);
    }
}

/**
 * Pelaa Suurempi vai Pienempi -noppapeliä
 * @param {string} choice - 'high' (suurempi) tai 'low' (pienempi)
 */
async function playHighLow(choice) {
    const betInput = document.getElementById('hilo-bet-modal') || document.getElementById('hilo-bet');
    const resultContainer = document.getElementById('hilo-modal-result') || document.getElementById('hilo-result');
    const bet = parseFloat(betInput.value);
    
    if (!validateBet(bet)) return;
    
    resultContainer.innerHTML = '<p class="loading">Heitetään noppia...</p>';
    resultContainer.classList.remove('hidden');
    
    try {
        const data = await apiCall('/api/clubhouse', {
            method: 'POST',
            body: JSON.stringify({
                game: 'high_low',
                choice: choice,
                bet: bet
            })
        });
        
        let winClass = 'info';
        let title = 'TASAPELI';
        if (data.voitto) { winClass = 'success-text'; title = 'VOITTO'; }
        else if (!data.push) { winClass = 'error-text'; title = 'HÄVIÖ'; }
        
        resultContainer.innerHTML = `
            <div class="kerhohuone-game-result-card">
                <h3>🎲 ${data.dice1} vs 🎲 ${data.dice2}</h3>
                <p class="${winClass}">${data.viesti}</p>
                <p>Uusi saldo: ${formatMoney(data.balance)} €</p>
            </div>
        `;
        
        if (data.voitto) showNotification(data.viesti, 'success');
        else if (data.push) showNotification(data.viesti, 'success', 'TASAPELI'); // Push ei ole teknisesti virhe
        else showNotification(data.viesti, 'error');
        
        await updateGameStats();
        await updateClubhouseCash();
        
    } catch (error) {
        handleGameError(error, resultContainer);
    }
}

/**
 * Pelaa Yksikätistä Rosvoa
 */
async function playSlots() {
    const betInput = document.getElementById('slots-bet-modal') || document.getElementById('slots-bet');
    const resultContainer = document.getElementById('slots-modal-result') || document.getElementById('slots-result');
    const slotsDisplay = document.querySelector('.kerhohuone-slots-display') || document.querySelector('.slots-display');
    const bet = parseFloat(betInput.value);
    
    if (!validateBet(bet)) return;
    
    // Visuaalinen efekti
    if (slotsDisplay) slotsDisplay.textContent = '🎰 🎰 🎰';
    resultContainer.innerHTML = '<p class="loading">Pyörii...</p>';
    resultContainer.classList.remove('hidden');
    
    try {
        const data = await apiCall('/api/clubhouse', {
            method: 'POST',
            body: JSON.stringify({
                game: 'slots',
                bet: bet
            })
        });
        
        // Päivitetään rullat
        if (slotsDisplay) slotsDisplay.textContent = `${data.reels[0]} ${data.reels[1]} ${data.reels[2]}`;
        
        const winClass = data.voitto ? 'success-text' : 'error-text';
        
        resultContainer.innerHTML = `
            <div class="kerhohuone-game-result-card">
                <p class="${winClass}">${data.viesti}</p>
                <p>Uusi saldo: ${formatMoney(data.balance)} €</p>
            </div>
        `;
        
        handleGameResult(data.voitto, data.viesti);
        await updateGameStats();
        await updateClubhouseCash();
        
    } catch (error) {
        handleGameError(error, resultContainer);
    }
}

// --- Apufunktiot ---

function validateBet(bet) {
    if (!bet || bet <= 0) {
        showNotification('Aseta kelvollinen panos!', 'error');
        return false;
    }
    return true;
}

function handleGameResult(won, message) {
    if (won) {
        showNotification(message, 'success', 'VOITTO');
    } else {
        showNotification(message, 'error', 'TAPPIO');
    }
}

function handleGameError(error, container) {
    console.error('Peli epäonnistui:', error);
    if (container) {
        container.innerHTML = '<p class="error-msg">❌ Peli epäonnistui</p>';
    }
    showNotification(error.message || 'Peli epäonnistui', 'error');
}