// Blackjack game logic and UI
// Kerhohuone 666 - Blackjack minigame

let blackjackState = {
    deck: [],
    dealerHand: [],
    playerHand: [],
    bet: 0,
    result: null,
    gameOver: false
};

// Global player cash tracking
let currentPlayerCash = 2450000;

// Update cash display in Blackjack view
async function updateBlackjackCash() {
    try {
        const response = await fetch('/api/game');
        if (response.ok) {
            const data = await response.json();
            if (data && data.cash) {
                currentPlayerCash = parseInt(data.cash);
                const cashDisplay = document.getElementById('blackjack-cash-display');
                if (cashDisplay) {
                    cashDisplay.textContent = `€${formatMoney(currentPlayerCash)}`;
                }
            }
        }
    } catch (error) {
        console.error('Blackjack cash update failed:', error);
    }
}

// Card deck utilities
function createDeck() {
    const suits = ['♥', '♦', '♣', '♠'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    let deck = [];
    
    // Create 6 decks (standard in casinos)
    for (let i = 0; i < 6; i++) {
        for (let suit of suits) {
            for (let rank of ranks) {
                deck.push({ rank, suit });
            }
        }
    }
    
    // Shuffle deck
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    
    return deck;
}

function drawCard() {
    if (blackjackState.deck.length === 0) {
        blackjackState.deck = createDeck();
    }
    return blackjackState.deck.pop();
}

function getCardValue(card) {
    if (card.rank === 'A') return 11;
    if (['J', 'Q', 'K'].includes(card.rank)) return 10;
    return parseInt(card.rank);
}

function calculateHandValue(hand) {
    let value = 0;
    let aces = 0;
    
    for (let card of hand) {
        const cardValue = getCardValue(card);
        if (card.rank === 'A') aces++;
        value += cardValue;
    }
    
    // Adjust for aces
    while (value > 21 && aces > 0) {
        value -= 10;
        aces--;
    }
    
    return value;
}

function startBlackjackGame(betAmount) {
    // Validate bet
    if (betAmount <= 0 || isNaN(betAmount)) {
        showNotification('Kelvoton panos! Syötä kelvollinen summa.', 'error');
        return;
    }
    
    if (betAmount > currentPlayerCash) {
        showNotification('Sinulla ei ole tarpeeksi rahaa!', 'error');
        return;
    }
    
    // Initialize game state
    blackjackState = {
        deck: createDeck(),
        dealerHand: [],
        playerHand: [],
        bet: betAmount,
        result: null,
        gameOver: false
    };
    
    // Deal initial cards
    blackjackState.playerHand.push(drawCard());
    blackjackState.playerHand.push(drawCard());
    blackjackState.dealerHand.push(drawCard());
    blackjackState.dealerHand.push(drawCard());
    
    // Check for blackjack
    const playerValue = calculateHandValue(blackjackState.playerHand);
    const dealerValue = calculateHandValue([blackjackState.dealerHand[0]]);
    
    if (playerValue === 21 && blackjackState.playerHand.length === 2) {
        // Natural blackjack - 3:2 payout
        blackjackState.result = 'blackjack';
        blackjackState.gameOver = true;
    }
    
    updateBlackjackUI();
    showBlackjackGameView();
}

function updateBlackjackUI() {
    // Update dealer hand
    const dealerHandElement = document.getElementById('dealer-cards');
    const dealerValueElement = document.getElementById('dealer-value');
    
    if (dealerHandElement) {
        dealerHandElement.innerHTML = '';
        for (let i = 0; i < blackjackState.dealerHand.length; i++) {
            if (i === 1 && !blackjackState.gameOver) {
                // Hide second card
                dealerHandElement.appendChild(createCardElement('?', ''));
            } else {
                dealerHandElement.appendChild(
                    createCardElement(
                        blackjackState.dealerHand[i].rank,
                        blackjackState.dealerHand[i].suit
                    )
                );
            }
        }
        
        if (dealerValueElement && blackjackState.gameOver) {
            const dealerValue = calculateHandValue(blackjackState.dealerHand);
            dealerValueElement.textContent = dealerValue;
        } else if (dealerValueElement) {
            dealerValueElement.textContent = calculateHandValue([blackjackState.dealerHand[0]]);
        }
    }
    
    // Update player hand
    const playerHandElement = document.getElementById('player-cards');
    const playerValueElement = document.getElementById('player-value');
    
    if (playerHandElement) {
        playerHandElement.innerHTML = '';
        for (let card of blackjackState.playerHand) {
            playerHandElement.appendChild(
                createCardElement(card.rank, card.suit)
            );
        }
        
        if (playerValueElement) {
            const playerValue = calculateHandValue(blackjackState.playerHand);
            playerValueElement.textContent = playerValue;
        }
    }
    
    // Update bet display
    const betElement = document.getElementById('bet-amount');
    if (betElement) {
        betElement.textContent = `$${blackjackState.bet.toLocaleString()}`;
    }
    
    // Update result message
    updateBlackjackResult();
}

function createCardElement(rank, suit) {
    // Emoji-kortit eri väreillä
    const suitEmojis = {
        '♥': '❤️',
        '♦': '💎',
        '♣': '♣️',
        '♠': '🔫'
    };
    
    const rankEmoji = {
        'A': '🅰️',
        'J': '👨',
        'Q': '👑',
        'K': '🤴',
        '?': '❓'
    };
    
    const suitEmoji = suitEmojis[suit] || (suit === '' && rank === '?' ? '' : suit);
    const displayRank = rankEmoji[rank] || rank;
    
    const isRed = suit === '♥' || suit === '♦';
    const bgColor = rank === '?' ? '#999999' : '#ffffff';
    const textColor = rank === '?' ? '#ffffff' : (isRed ? '#ff0000' : '#000000');
    
    // Käytä HTML-stringiä suoraan div-elementtiin
    const card = document.createElement('div');
    card.style.cssText = `
        background-color: ${bgColor};
        border: 2px solid ${textColor};
        border-radius: 8px;
        width: 60px;
        height: 90px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        font-weight: bold;
        font-size: 20px;
        padding: 4px;
    `;
    
    if (rank === '?') {
        card.innerHTML = `<div style="font-size: 32px;">?</div>`;
    } else {
        card.innerHTML = `
            <div style="font-size: 16px; color: ${textColor};">${displayRank}</div>
            <div style="font-size: 24px;">${suitEmoji}</div>
        `;
    }
    
    return card;
}

function playerHit() {
    if (blackjackState.gameOver) return;
    
    blackjackState.playerHand.push(drawCard());
    const playerValue = calculateHandValue(blackjackState.playerHand);
    
    if (playerValue > 21) {
        blackjackState.result = 'bust';
        blackjackState.gameOver = true;
        updateBlackjackUI();
        // Lähetä tulos palvelimelle välittömästi bust-tapauksessa
        submitBlackjackResult();
    } else {
        updateBlackjackUI();
    }
}

function playerStand() {
    if (blackjackState.gameOver) return;
    
    blackjackState.gameOver = true;
    
    // Dealer plays
    let dealerValue = calculateHandValue(blackjackState.dealerHand);
    while (dealerValue < 17) {
        blackjackState.dealerHand.push(drawCard());
        dealerValue = calculateHandValue(blackjackState.dealerHand);
    }
    
    // Determine winner
    const playerValue = calculateHandValue(blackjackState.playerHand);
    
    if (playerValue > 21) {
        blackjackState.result = 'bust';
    } else if (dealerValue > 21) {
        blackjackState.result = 'win';
    } else if (playerValue > dealerValue) {
        blackjackState.result = 'win';
    } else if (playerValue < dealerValue) {
        blackjackState.result = 'loss';
    } else {
        blackjackState.result = 'push';
    }
    
    updateBlackjackUI();
    
    // Lähetä tulos palvelimelle ja päivitä saldo
    submitBlackjackResult();
}

function updateBlackjackResult() {
    const resultElement = document.getElementById('blackjack-result');
    const actionButtons = document.getElementById('blackjack-actions');
    const endgameButtons = document.getElementById('blackjack-endgame-btns');
    
    if (!resultElement) return;
    
    resultElement.innerHTML = '';
    
    if (!blackjackState.gameOver) {
        // Peli jatkuu - näytä toimintanapit
        if (actionButtons) actionButtons.style.display = 'flex';
        if (endgameButtons) endgameButtons.classList.add('hidden');
        return;
    }
    
    const playerValue = calculateHandValue(blackjackState.playerHand);
    const dealerValue = calculateHandValue(blackjackState.dealerHand);
    
    let resultText = '';
    let resultColor = '';
    let winAmount = 0;
    
    if (blackjackState.result === 'blackjack') {
        resultText = 'BLACKJACK! 21 kahdella kortilla!';
        resultColor = '#05df72';
        winAmount = Math.floor(blackjackState.bet * 1.5);
    } else if (blackjackState.result === 'bust') {
        resultText = 'POSAHTANUT! Ylitit 21 - hävisit välittömästi.';
        resultColor = '#ff6467';
        winAmount = -blackjackState.bet;
    } else if (blackjackState.result === 'win') {
        resultText = `VOITIT! Sinulla ${playerValue}, jakajalla ${dealerValue}`;
        resultColor = '#05df72';
        winAmount = blackjackState.bet;
    } else if (blackjackState.result === 'loss') {
        resultText = `HÄVISIT. Jakajan käsi oli parempi.`;
        resultColor = '#ff6467';
        winAmount = -blackjackState.bet;
    } else if (blackjackState.result === 'push') {
        resultText = `TASAPELI! Molemmat saivat ${playerValue}`;
        resultColor = '#d1d5dc';
        winAmount = 0;
    }
    
    resultElement.innerHTML = `
        <div style="color: ${resultColor}; font-size: 16px; text-align: center; line-height: 24px;">
            ${resultText}
        </div>
        <div style="color: #d1d5dc; font-size: 18px; font-weight: normal; text-align: center; line-height: 28px;">
            ${winAmount >= 0 ? '+' : ''}${winAmount} $
        </div>
    `;
    
    // Peli loppui - piilota toimintanapit ja näytä "Uusi kierros" -nappi
    if (actionButtons) actionButtons.style.display = 'none';
    if (endgameButtons) endgameButtons.classList.remove('hidden');
}

function newBlackjackRound() {
    // Reset for next round
    blackjackState = {
        deck: blackjackState.deck,
        dealerHand: [],
        playerHand: [],
        bet: 0,
        result: null,
        gameOver: false
    };
    
    showBlackjackSetupView();
}

function showBlackjackSetupView() {
    const setupView = document.getElementById('blackjack-setup');
    const gameView = document.getElementById('blackjack-game');
    const gameTitle = document.getElementById('blackjack-game-title');
    
    if (setupView) {
        setupView.style.display = 'block';
        setupView.classList.remove('hidden');
    }
    if (gameView) {
        gameView.style.display = 'none';
        gameView.classList.add('hidden');
    }
    if (gameTitle) {
        gameTitle.classList.remove('active');
    }
}

function showBlackjackGameView() {
    const setupView = document.getElementById('blackjack-setup');
    const gameView = document.getElementById('blackjack-game');
    const gameTitle = document.getElementById('blackjack-game-title');
    
    if (setupView) setupView.style.display = 'none';
    if (gameView) {
        gameView.style.display = 'block';
        gameView.classList.remove('hidden');
    }
    if (gameTitle) {
        gameTitle.classList.add('active');
        gameTitle.textContent = 'BLACKJACK';
    }
}

function startBlackjackFromInput() {
    const betInput = document.getElementById('blackjack-bet-input');
    if (!betInput) return;
    
    const bet = parseInt(betInput.value);
    
    // Tarkistetaan pelaajan saldo
    if (bet > currentPlayerCash) {
        showNotification('Sinulla ei ole tarpeeksi rahaa panokselle!', 'error');
        return;
    }
    
    startBlackjackGame(bet);
}

function goBackToClubhouse() {
    // Return to clubhouse menu
    const setupView = document.getElementById('blackjack-setup');
    const gameView = document.getElementById('blackjack-game');
    
    if (setupView) setupView.style.display = 'none';
    if (gameView) gameView.style.display = 'none';
    
    showClubhouseMenu();
}

function showClubhouseMenu() {
    // This will be called when returning from Blackjack
    // Switch back to the main clubhouse view
    showView('clubhouse');
}

/**
 * Lähettää blackjack-pelin tulokset palvelimelle ja päivittää pelaajan saldon
 */
async function submitBlackjackResult() {
    try {
        const playerValue = calculateHandValue(blackjackState.playerHand);
        const dealerValue = calculateHandValue(blackjackState.dealerHand);
        
        // Määritä voittosumma
        let winnings = 0;
        if (blackjackState.result === 'blackjack') {
            winnings = Math.floor(blackjackState.bet * 1.5);
        } else if (blackjackState.result === 'bust') {
            winnings = -blackjackState.bet;
        } else if (blackjackState.result === 'win') {
            winnings = blackjackState.bet;
        } else if (blackjackState.result === 'loss') {
            winnings = -blackjackState.bet;
        } else if (blackjackState.result === 'push') {
            winnings = 0;
        }
        
        // Lähetä API:lle
        const response = await fetch('/api/clubhouse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game: 'blackjack',
                bet: blackjackState.bet,
                result: blackjackState.result,
                player_value: playerValue,
                dealer_value: dealerValue
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.cash !== undefined) {
            // Päivitä näytöllä oleva saldo blackjack-näkymässä
            const newCash = parseInt(data.cash);
            currentPlayerCash = newCash;
            const cashDisplay = document.getElementById('blackjack-cash-display');
            if (cashDisplay) {
                cashDisplay.textContent = `€${formatMoney(newCash)}`;
            }
            
            // Päivitä pääpalkin cash-näyttö
            const mainCashDisplay = document.getElementById('cash-amount');
            if (mainCashDisplay) {
                mainCashDisplay.textContent = `€${formatMoney(newCash)}`;
            }
        }
    } catch (error) {
        console.error('Blackjack-tuloksen lähetys epäonnistui:', error);
    }
}
