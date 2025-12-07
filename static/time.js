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
        // päivitetään
        await updateGameStats();
    } catch (error) {
        console.error("Päivän kelaus epäonnistui:", error);
        showNotification("Päivän kelaus epäonnistui.", "error");
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
        displayDayAdvanceSummary(result);
        // päivitetään
        await updateGameStats();
    } catch (error) {
        console.error("Pelin kelaus epäonnistui:", error);
        showNotification("Pelin kelaus epäonnistui.", "error");
    }
}

/**
 * näyttää yhteenvedon päivän edistämisestä
 */
function displayDayAdvanceSummary(result) {
    const message = `
        Päivä: ${result.day}
        Saapumiset: ${result.arrivals}
        Ansiot: ${result.earned} €

    `;
    showNotification(message, "success", "Päivä edistynyt");

    // saapumiset
    if (result.arrival_details && result.arrival_details.length > 0) {
        console.log("Saapumiset:", result.arrival_details);
    }
    // tapahtumat
    if (result.events && result.events.length > 0) {
        console.log("Tapahtumat:", result.events);
    }
    // laskut
    if (result.bills && result.bills.length > 0) {
        console.log("Laskut:", result.bills);
    }
}
/**
 * yhteenvedon näyttäminen
 */
function displayFastForwardSummary(result) {
    const messages = {
        "arrival" : `Lentopalasi päivänä ${result.current_day}`,
        'bankrupt' : `Peli päättyi konkurssiin päivänä ${result.current_day}`,
        "victory" : `Voitto! Peli voitettu päivänä ${result.current_day}!`,
        "max" : `Kelaus pysähtyi päivänä ${result.days_advanced}.`,
        "no_flights" : `Ei lentoja`,
    };

    const message = `
        ${messages[result.stop_reason] || "Kelaus päättynyt."}
        Päiviä edetty: ${result.days_advanced}
        Ansiot yhteensä: ${result.total_earned} €
    `;
    showNotification(message, "success", "Kelaus päättynyt");

    if (result.day_summaries) {
        console.log("Päiväkohtainen yhteenveto:", result.day_summaries);
    }
}

