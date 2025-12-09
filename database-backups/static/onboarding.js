/**
 * AFC 666 - Onboarding & Modaali-komponentit
 * Hallinnoi splash screen, päävalikkoa, new game modal ja tutoriaalia
 */

// === GLOBAALI TILA ===
let currentNewGameStep = 1;
let currentOnboardingStep = 1;
let newGameData = {
    name: '',
    startingCash: 300000,
    seed: null
};

// === SPLASH SCREEN -> PÄÄVALIKKO SIIRTYMÄ ===
function initializeSplashScreen() {
    // Splash screen näkyy automaattisesti, klikkaus siirtää päävalikkoon
    const splashScreen = document.getElementById('splash-screen');
    const startScreen = document.getElementById('start-screen');
    
    if (splashScreen) {
        splashScreen.addEventListener('click', transitionToMainMenu);
        // Näytä splash screen ensin
        splashScreen.classList.remove('hidden');
        if (startScreen) startScreen.classList.add('hidden');
    }
}

function transitionToMainMenu() {
    const splashScreen = document.getElementById('splash-screen');
    const startScreen = document.getElementById('start-screen');
    
    // Fade out splash screen
    splashScreen.classList.add('fade-out');
    
    // Näytä päävalikko (#start-screen) fade-in:lla
    setTimeout(() => {
        splashScreen.classList.add('hidden');
        if (startScreen) {
            startScreen.classList.remove('hidden');
            startScreen.classList.add('fade-in');
        }
    }, 300);
}

// === PÄÄVALIKKO FUNKTIOT ===

/**
 * Käynnistyy kun käyttäjä klikkaa "Aloita Uusi Peli" -nappia
 * Linkki: start-screen "Aloita Uusi Peli" -nappiin
 */
function startNewGame() {
    openNewGameModal();
}

/**
 * Käynnistyy kun käyttäjä klikkaa "Lataa Peli" -nappia
 * Linkki: start-screen "Lataa Peli" -nappiin
 */
function loadGame() {
    openLoadGameModal();
}

function openNewGameModal() {
    const startScreen = document.getElementById('start-screen');
    const newGameModal = document.getElementById('new-game-modal');
    
    // Nollaa uusi peli -tiedot
    currentNewGameStep = 1;
    newGameData = {
        name: '',
        startingCash: 300000,
        seed: null
    };
    
    startScreen.classList.add('hidden');
    newGameModal.classList.remove('hidden');
    updateNewGameModal();
}

function closeNewGameModal() {
    const startScreen = document.getElementById('start-screen');
    const newGameModal = document.getElementById('new-game-modal');
    
    newGameModal.classList.add('hidden');
    startScreen.classList.remove('hidden');
}

function openLoadGameModal() {
    const startScreen = document.getElementById('start-screen');
    const loadGameModal = document.getElementById('load-game-modal');
    const loadGameList = document.getElementById('load-game-list');
    
    startScreen.classList.add('hidden');
    loadGameModal.classList.remove('hidden');
    
    // Lataa tallennetut pelit API:sta
    loadSavedGames();
}

function closeLoadGameModal() {
    const startScreen = document.getElementById('start-screen');
    const loadGameModal = document.getElementById('load-game-modal');
    
    loadGameModal.classList.add('hidden');
    startScreen.classList.remove('hidden');
}

async function loadSavedGames() {
    try {
        const response = await fetch('/api/games');
        if (!response.ok) throw new Error('Failed to fetch games');
        
        const data = await response.json();
        const games = data.games || [];
        
        const loadGameList = document.getElementById('load-game-list');
        
        if (games.length === 0) {
            loadGameList.innerHTML = '<p style="text-align: center; color: #6a7282; padding: 40px;">Ei tallennettuja pelejä</p>';
            return;
        }
        
        // Muodosta pelirivit
        let html = '';
        games.forEach((game, index) => {
            const gameId = String(index + 1).padStart(3, '0'); // 001, 002, jne
            const playerName = game.player_name || 'Tuntematon';
            const currentDay = game.current_day || 1;
            const cash = game.cash || 0;
            const baseId = game.base_id || 'UNKNOWN';
            
            // Formatoi raha euroiksi
            const cashFormatted = '€' + new Intl.NumberFormat('fi-FI', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            }).format(cash);
            
            html += `
                <div class="load-game-item">
                    <div class="load-game-id">${gameId}</div>
                    <div class="load-game-info">
                        <div class="load-game-player">
                            <span class="load-game-player-icon">👤</span>
                            <span class="load-game-player-name">${playerName}</span>
                        </div>
                        <div class="load-game-location">${baseId}</div>
                        <div class="load-game-date">${new Date(game.created_at || Date.now()).toLocaleDateString('fi-FI')}</div>
                    </div>
                    <div class="load-game-stats">
                        <div class="load-game-stat">
                            <span class="load-game-stat-label">PÄIVÄ</span>
                            <span class="load-game-stat-value">${currentDay}</span>
                        </div>
                        <div class="load-game-stat">
                            <span class="load-game-stat-label">SALDO</span>
                            <span class="load-game-stat-value load-game-stat-cash">${cashFormatted}</span>
                        </div>
                    </div>
                    <button class="load-game-btn" onclick="selectGameAndLoad(${game.id})">LATAA</button>
                </div>
            `;
        });
        
        loadGameList.innerHTML = html;
    } catch (error) {
        console.error('Error loading games:', error);
        const loadGameList = document.getElementById('load-game-list');
        loadGameList.innerHTML = '<p style="text-align: center; color: #fb2c36; padding: 40px;">Virhe pelien lataamisessa</p>';
    }
}

async function selectGameAndLoad(gameId) {
    try {
        const response = await fetch(`/api/games/${gameId}/load`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) throw new Error('Failed to load game');
        
        const data = await response.json();
        
        // Peli on ladattu, siirry dashboardiin
        closeLoadGameModal();
        showView('dashboard-view');
        
    } catch (error) {
        console.error('Error loading game:', error);
        alert('Pelin lataaminen epäonnistui');
    }
}

function showSettings() {
    // TODO: Implementoi asetukset-näkymä
    alert('Asetukset tulossa...');
}

function exitGame() {
    // Sulkee selaimen tai ohjaa pois sovelluksesta
    if (window.location.protocol === 'file:') {
        alert('Peli suljetaan...');
    } else {
        window.close();
    }
}

// === NEW GAME MODAL FUNKTIOT ===
function updateNewGameModal() {
    // Päivitä step indicator ja otsikko
    const stepIndicator = document.getElementById('new-game-step-indicator');
    const modalTitle = document.getElementById('new-game-modal-title');
    const modalSubtitle = document.querySelector('.modal-subtitle') || null;
    
    stepIndicator.textContent = `VAIHE ${currentNewGameStep}/3`;
    
    // Piilota/näytä takaisin-nappi
    const backButton = document.querySelector('#new-game-modal .modal-back-btn');
    if (currentNewGameStep === 1) {
        backButton.style.display = 'none';
    } else {
        backButton.style.display = 'block';
    }
    
    // Näytä oikea sisältö vaiheen perusteella
    const modalBody = document.getElementById('new-game-modal-body');
    const nextButton = document.querySelector('#new-game-modal .modal-next-btn');
    
    if (currentNewGameStep === 1) {
        // Vaihe 1: Yrityksen nimi
        modalTitle.textContent = 'ANNA YRITYKSEN NIMI';
        if (modalSubtitle) modalSubtitle.textContent = 'Valitse nimi rahtiyhtiöllesi';
        
        modalBody.innerHTML = `
            <div class="new-game-form-group">
                <label class="form-label">Yrityksen nimi</label>
                <input 
                    type="text" 
                    id="company-name-input" 
                    class="form-input" 
                    placeholder="Anna yrityksesi nimi..." 
                    value="${newGameData.name}"
                    maxlength="50"
                >
            </div>
        `;
        
        // Lisää event listener
        setTimeout(() => {
            const input = document.getElementById('company-name-input');
            if (input) {
                input.focus();
                input.addEventListener('change', function() {
                    newGameData.name = this.value;
                });
            }
        }, 50);
        
        nextButton.textContent = 'Seuraava';
        
    } else if (currentNewGameStep === 2) {
        // Vaihe 2: Alkupääoma
        modalTitle.textContent = 'ASETA ALKUPÄÄOMA';
        if (modalSubtitle) modalSubtitle.textContent = 'Määritä alkupääomasi';
        
        modalBody.innerHTML = `
            <div class="new-game-form-group">
                <label class="form-label">Alkupääoma</label>
                <div class="currency-input-wrapper">
                    <input 
                        type="number" 
                        id="starting-cash-input" 
                        class="form-input" 
                        placeholder="300 000" 
                        value="${newGameData.startingCash}"
                        min="50000"
                        max="10000000"
                    >
                    <span class="currency-symbol">€</span>
                </div>
                <p class="form-helper-text">
                    Oletus: <strong>300 000 €</strong> • Jätä tyhjäksi käyttääksesi oletusta
                </p>
            </div>
        `;
        
        // Lisää event listener
        setTimeout(() => {
            const input = document.getElementById('starting-cash-input');
            if (input) {
                input.addEventListener('change', function() {
                    newGameData.startingCash = parseInt(this.value) || 300000;
                });
            }
        }, 50);
        
        nextButton.textContent = 'Seuraava';
        
    } else if (currentNewGameStep === 3) {
        // Vaihe 3: Pelin siemen
        modalTitle.textContent = 'ASETA PELIN SIEMEN';
        if (modalSubtitle) modalSubtitle.textContent = 'Valinnainen: Anna siemen toistettavalle pelille';
        
        modalBody.innerHTML = `
            <div class="new-game-form-group">
                <label class="form-label">Pelin siemen (valinnainen)</label>
                <input 
                    type="text" 
                    id="seed-input" 
                    class="form-input" 
                    placeholder="Jätä tyhjäksi satunnaista varten" 
                    value="${newGameData.seed || ''}"
                    maxlength="100"
                >
                <div class="form-info-box">
                    <span class="info-icon">ℹ️</span>
                    <div class="info-text">
                        <strong>INFO:</strong> Jätä tyhjäksi satunnaista peliä varten. Anna teksti toistettavia pelejä varten.
                    </div>
                </div>
            </div>
        `;
        
        // Lisää event listener
        setTimeout(() => {
            const input = document.getElementById('seed-input');
            if (input) {
                input.addEventListener('change', function() {
                    newGameData.seed = this.value || null;
                });
            }
        }, 50);
        
        nextButton.textContent = 'Aloita Peli';
    }
}

function nextNewGameStep() {
    // Validaatio vaiheittain
    if (currentNewGameStep === 1) {
        const nameInput = document.getElementById('company-name-input');
        if (nameInput) {
            newGameData.name = nameInput.value;
        }
        if (!newGameData.name || !newGameData.name.trim()) {
            showValidationError('Anna yrityksen nimi!');
            return;
        }
    } else if (currentNewGameStep === 2) {
        const cashInput = document.getElementById('starting-cash-input');
        if (cashInput) {
            const value = parseInt(cashInput.value);
            if (!isNaN(value)) {
                newGameData.startingCash = value;
            }
        }
        if (!newGameData.startingCash || newGameData.startingCash < 50000) {
            showValidationError('Alkupääoman on oltava vähintään 50 000 €!');
            return;
        }
        if (newGameData.startingCash > 10000000) {
            showValidationError('Alkupääoma voi olla enintään 10 000 000 €!');
            return;
        }
    } else if (currentNewGameStep === 3) {
        const seedInput = document.getElementById('seed-input');
        if (seedInput) {
            newGameData.seed = seedInput.value || null;
        }
    }
    
    if (currentNewGameStep < 3) {
        currentNewGameStep++;
        updateNewGameModal();
    } else if (currentNewGameStep === 3) {
        // Aloita peli
        submitNewGame();
    }
}

// Näytä validointivirhe käyttäjäystävällisesti
function showValidationError(message) {
    // Luo tilapäinen virheilmoitus modaalin päälle
    const modal = document.getElementById('new-game-modal');
    const existingError = document.querySelector('.validation-error-toast');
    if (existingError) {
        existingError.remove();
    }
    
    const errorEl = document.createElement('div');
    errorEl.className = 'validation-error-toast';
    errorEl.textContent = message;
    document.body.appendChild(errorEl);
    
    // Poista virhe 3 sekunnin jälkeen
    setTimeout(() => {
        if (errorEl.parentNode) {
            errorEl.remove();
        }
    }, 3000);
}

function previousNewGameStep() {
    if (currentNewGameStep > 1) {
        currentNewGameStep--;
        updateNewGameModal();
    }
}

function submitNewGame() {
    // Lähettää API-kutsun uuden pelin luomiseksi
    const submitButton = document.querySelector('#new-game-modal .modal-next-btn');
    const originalText = submitButton.textContent;
    
    // Näytä lataamisen tila
    submitButton.disabled = true;
    submitButton.textContent = 'Ladataan...';
    
    // Rakenna API:lle oikean muotoinen data
    const gameData = {
        player_name: newGameData.name,
        starting_cash: newGameData.startingCash,
        rng_seed: newGameData.seed,
        difficulty: 'NORMAL'
    };
    
    console.log('Lähetetään uusi peli:', gameData);
    
    fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gameData)
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(data => {
                throw new Error(data.Virhe || `HTTP ${response.status}`);
            });
        }
        return response.json();
    })
    .then(data => {
        console.log('Peli luotu:', data);
        // Varmista, että meillä on save_id
        if (data.save_id) {
            // Sulkea new game modal
            const newGameModal = document.getElementById('new-game-modal');
            if (newGameModal) newGameModal.classList.add('hidden');
            
            // Avaa onboarding tutoriaali
            openOnboardingModal();
        } else {
            throw new Error('Pelin luominen epäonnistui: tallennuksen tunnistetta ei saatu');
        }
    })
    .catch(error => {
        console.error('Virhe pelin luomisessa:', error);
        submitButton.disabled = false;
        submitButton.textContent = originalText;
        showValidationError('Virhe pelin luomisessa: ' + error.message);
    });
}

// === ONBOARDING MODAL FUNKTIOT ===
function openOnboardingModal() {
    // Piilota new game modal, näytä onboarding tutoriaali
    const newGameModal = document.getElementById('new-game-modal');
    const onboardingModal = document.getElementById('onboarding-modal');
    
    if (newGameModal) newGameModal.classList.add('hidden');
    if (onboardingModal) {
        onboardingModal.classList.remove('hidden');
    }
    
    currentOnboardingStep = 1;
    updateOnboardingModal();
}

function closeOnboardingModal() {
    const onboardingModal = document.getElementById('onboarding-modal');
    if (onboardingModal) {
        onboardingModal.classList.add('hidden');
    }
    
    // Siirry kojelautaan
    showView('dashboard-view');
}

function updateOnboardingModal() {
    const stepIndicator = document.getElementById('onboarding-step-indicator');
    stepIndicator.textContent = `${currentOnboardingStep}/5`;
    
    // Piilota/näytä takaisin-nappi
    const backButton = document.querySelector('#onboarding-modal .modal-back-btn');
    if (backButton) {
        if (currentOnboardingStep === 1) {
            backButton.style.display = 'none';
        } else {
            backButton.style.display = 'block';
        }
    }
    
    // Muuta seuraava-napin teksti
    const nextButton = document.querySelector('#onboarding-modal .modal-next-btn');
    if (nextButton) {
        if (currentOnboardingStep === 5) {
            nextButton.textContent = 'Aloita Peli';
        } else {
            nextButton.textContent = 'Jatka';
        }
    }
    
    // Näytä tutoriaalisivun sisältö
    const onboardingContent = document.getElementById('onboarding-content');
    
    const contents = {
        1: {
            title: 'LENTORAHTIYHTIÖ 666',
            subtitle: 'Tarinan alku...',
            text: 'Olet nyt lentorahtiyhtiön omistaja',
            image: 'img/story-images/step1-prolog.webp'
        },
        2: {
            title: 'TEHTÄVÄ',
            subtitle: 'Tavoitteesi',
            text: 'Tehtäväsi on selviytyä 666 päivää',
            image: 'img/story-images/step2-tavoite.webp'
        },
        3: {
            title: 'PERINTÖ',
            subtitle: 'Isoisäsi lahja',
            text: 'Isoisäsi antoi sinulle yhtiönsä ja Douglas DC-3 lentokoneen',
            image: 'img/story-images/step3-perintö.webp'
        },
        4: {
            title: 'HAASTE',
            subtitle: 'Mutta ei kaikki ole ruusuilla tanssimista...',
            text: 'Ja sait myös hänen velkansa, onnea!',
            image: 'img/story-images/step4-kauppa.webp'
        },
        5: {
            title: 'LASKUT JA MAKSUT',
            subtitle: 'Muista erääntymispäivät',
            text: 'Jokaisen 30. päivän kohdalla kaikki laskut ja maksut erääntyvät. Varmista, että sinulla on tarpeeksi rahaa tai raha vähennetään saldostasi automaattisesti.',
            image: 'img/story-images/step5-nousu.webp'
        }
    };
    
    const content = contents[currentOnboardingStep];
    
    onboardingContent.innerHTML = `
        <div class="onboarding-image-container">
            ${content.image ? `<img src="${content.image}" alt="Vaihe ${currentOnboardingStep}" class="onboarding-image">` : '<div class="onboarding-image-placeholder"></div>'}
        </div>
        <div class="onboarding-text-container">
            <p class="onboarding-text">${content.text}</p>
        </div>
    `;
    
    document.getElementById('onboarding-modal-title').textContent = content.title;
}

function nextOnboardingStep() {
    if (currentOnboardingStep < 5) {
        currentOnboardingStep++;
        updateOnboardingModal();
    } else if (currentOnboardingStep === 5) {
        // Viimeinen askel - siirry dashboardiin
        completeOnboarding();
    }
}

function previousOnboardingStep() {
    if (currentOnboardingStep > 1) {
        currentOnboardingStep--;
        updateOnboardingModal();
    }
}

function completeOnboarding() {
    // Piilota onboarding, näytä pelinäyttö
    const onboardingModal = document.getElementById('onboarding-modal');
    const gameContainer = document.getElementById('game-container');
    const splashScreen = document.getElementById('splash-screen');
    
    if (onboardingModal) onboardingModal.classList.add('hidden');
    if (splashScreen) splashScreen.classList.add('hidden');
    if (gameContainer) gameContainer.classList.remove('hidden');
    
    // Kutsuu pääsovelluksen showGameScreen() funktioita
    if (typeof showGameScreen === 'function') {
        showGameScreen();
    }
    if (typeof updateGameStats === 'function') {
        updateGameStats();
    }
    if (typeof showView === 'function') {
        showView('dashboard');
    }
}

// === ALUSTUS ===
document.addEventListener('DOMContentLoaded', function() {
    initializeSplashScreen();
});
