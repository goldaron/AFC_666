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
    showNotification("Siirrytään 1 päivä eteenpäin.", "info");

    try {
        // kutsutaan APIa
        const result = await apiCall("/api/game/advance-day", { method: "POST" });
        // tulokset
        displayDayAdvanceSummary(result);
        // päivitetään yläpalkki
        await updateGameStats();
        // päivitetään aktiivinen näkymä
        reloadCurrentView();
    } catch (error) {
        console.error("Päivän kelaus epäonnistui:", error);
        showNotification(`Päivän kelaus epäonnistui: ${error.message}`, "error");
    }
}

/**
 * siirtää pelia eteenpäin siihen asti että eka lento palannut
 */
async function startFastForward() {
    showNotification("Kelaus käynnissä. Odota...", "info");

    try {
        // kutsutaan APIa
        const result = await apiCall("/api/game/fast-forward", { method: "POST" });
        // tulokset
        displayFastForwardSummary(result); // Kutsutaan oikeaa yhteenvetofunktiota
        // päivitetään yläpalkki
        await updateGameStats();
        // päivitetään aktiivinen näkymä
        reloadCurrentView();
    } catch (error) {
        console.error("Pelin kelaus epäonnistui:", error);
        showNotification(`Pelin kelaus epäonnistui: ${error.message}`, "error");
    }
}

/**
 * näyttää yhteenvedon päivän edistämisestä
 */
function displayDayAdvanceSummary(result) {
    // Parannellaan viestiä näyttämään enemmän tietoa
    let message = `Päivä: ${result.day}. Saapumisia: ${result.arrivals}. Ansiot: ${formatMoney(result.earned)} €`;

    if (result.events && result.events.length > 0) {
        message += `\nTapahtumat: ${result.events.map(e => e.name).join(', ')}`;
    }
    if (result.bills && result.bills.length > 0) {
        message += `\nLaskuja: ${result.bills.length}`;
    }

    showNotification(message, "success", "Päivä edistynyt");

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

    if (result.day_summaries) {
        console.log("Päiväkohtainen yhteenveto:", result.day_summaries);
    }
}
