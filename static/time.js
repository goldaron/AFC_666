/**
 * time.js vastaa päivien kelauksesta
 * päivän siirtäminen seuraavaan
 * päivän siirtyminen siihen asti että eka lento palanut
 * 
 * endpointit:
 * - POST /api/game/advance-day  → Edistä peliä yhdellä päivällä
 * -POST /api/game/fast-forward → Edistä peliä kunnes ensimmäinen lento saapuu
 * 
 */

/**
 * siirtää pelia yhdellä päivällä eteenpäin
 */
async function advanceDay() {
    showNotification('Siirretään päivää...', 'info');
    
    try {
        const result = await apiCall('/api/game/advance-day', { method: 'POST' });
        displayDayAdvanceSummary(result);
        await updateGameStats();
        
        // Päivitä tapahtumaloki
        const response = await fetch('/api/game/events?limit=10');
        const data = await response.json();
        displayEventLog(data.events);
        
    } catch (error) {
        console.error('Päivän siirto epäonnistui:', error);
        showNotification('Päivän siirto epäonnistui', 'error');
    }
}

/**
 * siirtää pelia eteenpäin siihen asti että eka lento palannut
 */
async function startFastForward() {
    showNotification('Pikakelaus käynnissä...', 'info');
    
    try {
        const result = await apiCall('/api/game/fast-forward', { method: 'POST' });
        displayFastForwardSummary(result);
        await updateGameStats();
        
        // Päivitä tapahtumaloki
        const response = await fetch('/api/game/events?limit=10');
        const data = await response.json();
        displayEventLog(data.events);
        
    } catch (error) {
        console.error('Pikakelaus epäonnistui:', error);
        showNotification('Pikakelaus epäonnistui', 'error');
    }
}

/**
 * näyttää yhteenvedon päivän edistämisestä
 */
function displayDayAdvanceSummary(result) {
    let message = `Päivä: ${result.day}. Saapumisia: ${result.arrivals}. Ansiot: ${formatMoney(result.earned)} €`;

    if (result.events && result.events.length > 0) {
        message += `\nTapahtumat: ${result.events.map(e => e.name).join(', ')}`;
    }
    if (result.bills && result.bills.length > 0) {
        message += `\nLaskuja: ${result.bills.length}`;
    }

    showNotification(message, "success", "Päivä edistynyt");

    // Soita ääni jos koneet saapuivat
    if (result.arrivals && result.arrivals > 0) {
        playEventSound('arrival_notification.mp3');
    }

    if (result.arrival_details && result.arrival_details.length > 0) {
        console.log("Saapumiset:", result.arrival_details);
    }
    if (result.events && result.events.length > 0) {
        console.log("Tapahtumat:", result.events);
    }
    if (result.bills && result.bills.length > 0) {
        console.log("Laskut:", result.bills);
    }
}
/**
 * yhteenvedon näyttäminen
 */
function displayFastForwardSummary(result) {
    const messages = {
        "arrival" : `Lento palasi päivänä ${result.current_day}`,
        'bankrupt' : `Peli päättyi konkurssiin päivänä ${result.current_day}`,
        "victory" : `Voitto! Peli voitettu päivänä ${result.current_day}!`,
        "max" : `Kelaus pysähtyi ${result.days_advanced} päivän jälkeen.`,
        "no_flights" : `Ei lentoja kelattavaksi.`,
    };

    const message = `
        ${messages[result.stop_reason] || "Kelaus päättynyt."}
        Päiviä edetty: ${result.days_advanced}.
        Ansiot yhteensä: ${formatMoney(result.total_earned)} €.
    `;
    showNotification(message, "success", "Kelaus päättynyt");

    // Soita ääni jos saapuminen tai voitto
    if (result.stop_reason === 'arrival' || result.stop_reason === 'victory') {
        playEventSound('arrival_notification.mp3');
    }

    if (result.day_summaries) {
        console.log("Päiväkohtainen yhteenveto:", result.day_summaries);
    }
}
