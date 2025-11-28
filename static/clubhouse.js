/**
 * clubhouse.js - Kerhohuoneen hallinta (Developer 4)
 * Vastaa minipelien (Coin Flip, High/Low, Slots) pelaamisesta
 */

/**
 * Pelaa kolikonheittoa
 * @param {string} choice - Valinta: 'heads' (kruuna) tai 'tails' (klaava)
 */
async function playCoinFlip(choice) {
    const betInput = document.getElementById('coin-flip-bet');
    const resultContainer = document.getElementById('coin-flip-result');
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
            <div class="game-result-card">
                <h3>TULOS: ${resultEmoji}</h3>
                <p class="${winClass}">${data.viesti}</p>
                <p>Uusi saldo: ${formatMoney(data.balance)} €</p>
            </div>
        `;
        
        handleGameResult(data.voitto, data.viesti);
        await updateGameStats();
        
    } catch (error) {
        handleGameError(error, resultContainer);
    }
}

/**
 * Pelaa Suurempi vai Pienempi -noppapeliä
 * @param {string} choice - 'high' (suurempi) tai 'low' (pienempi)
 */
async function playHighLow(choice) {
    const betInput = document.getElementById('hilo-bet');
    const resultContainer = document.getElementById('hilo-result');
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
            <div class="game-result-card">
                <h3>🎲 ${data.dice1} vs 🎲 ${data.dice2}</h3>
                <p class="${winClass}">${data.viesti}</p>
                <p>Uusi saldo: ${formatMoney(data.balance)} €</p>
            </div>
        `;
        
        if (data.voitto) showNotification(data.viesti, 'success');
        else if (data.push) showNotification(data.viesti, 'success', 'TASAPELI'); // Push ei ole teknisesti virhe
        else showNotification(data.viesti, 'error');
        
        await updateGameStats();
        
    } catch (error) {
        handleGameError(error, resultContainer);
    }
}

/**
 * Pelaa Yksikätistä Rosvoa
 */
async function playSlots() {
    const betInput = document.getElementById('slots-bet');
    const resultContainer = document.getElementById('slots-result');
    const slotsDisplay = document.querySelector('.slots-display');
    const bet = parseFloat(betInput.value);
    
    if (!validateBet(bet)) return;
    
    // Visuaalinen efekti
    slotsDisplay.textContent = '🎰 🎰 🎰';
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
        slotsDisplay.textContent = `${data.reels[0]} ${data.reels[1]} ${data.reels[2]}`;
        
        const winClass = data.voitto ? 'success-text' : 'error-text';
        
        resultContainer.innerHTML = `
            <div class="game-result-card">
                <p class="${winClass}">${data.viesti}</p>
                <p>Uusi saldo: ${formatMoney(data.balance)} €</p>
            </div>
        `;
        
        handleGameResult(data.voitto, data.viesti);
        await updateGameStats();
        
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