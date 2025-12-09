/**
 * Näyttää tapahtumalokin kojelaudan log-containerissa
 */
async function fetchEventLog(limit = 10) {
    try {
        const response = await fetch(`/api/game/events?limit=${limit}`);
        if (!response.ok) throw new Error('Virhe haettaessa tapahtumia');
        const data = await response.json();
        displayEventLog(data.events);
        return data.events;
    } catch (error) {
        console.error('Tapahtumien haku epäonnistui:', error);
    }
}
function displayEventLog(events) {
    const logContainer = document.querySelector('.log-container');
    if (!logContainer) return;
    
    const entries = logContainer.querySelectorAll('.log-entry');
    entries.forEach(entry => entry.remove());
    
    if (!events || events.length === 0) return;
    
    events.forEach((event) => {
        const entry = document.createElement('div');
        entry.className = 'log-entry log-entry-cyan';
        
        const time = event.created_at.substring(11, 19);
        let message = '';
        const payload = event.payload || '';
        
        switch(event.event_type) {
            case 'DAY_ADVANCE':
                const day = payload.match(/new_day=(\d+)/)?.[1] || '?';
                const arrivals = payload.match(/arrivals=(\d+)/)?.[1] || '0';
                const earned = payload.match(/earned=([\d.]+)/)?.[1] || '0.00';
                message = `Päivä ${day} • Saapuneet: ${arrivals} • Ansio: €${earned}`;
                break;
            case 'CONTRACT_STARTED':
                const dest = payload.match(/dest=([^;]+)/)?.[1] || '?';
                const wt = payload.match(/payload=(\d+)/)?.[1] || '?';
                const eta = payload.match(/eta_day=(\d+)/)?.[1] || '?';
                message = `📦 Sopimus: ${dest} • ${wt}kg • ETA pv ${eta}`;
                break;
            case 'CONTRACT_COMPLETED':
                const reward = payload.match(/reward=([\d.]+)/)?.[1] || '0';
                message = `✅ Sopimus valmistui: +€${reward}`;
                break;
            case 'FLIGHT_RTB_CREATED':
                const from = payload.match(/from=([^;]+)/)?.[1] || '?';
                const to = payload.match(/to=([^;]+)/)?.[1] || '?';
                const eta2 = payload.match(/eta_day=(\d+)/)?.[1] || '?';
                message = `✈️ Paluu-lento: ${from} → ${to} (ETA pv ${eta2})`;
                break;
            case 'AIRCRAFT_PURCHASE':
                message = `🛩️ Lentokone ostettu`;
                break;
            case 'AIRCRAFT_GIFT':
                message = `🎁 Lahja-lentokone saatu`;
                break;
            case 'AIRCRAFT_REPAIR':
                message = `🔧 Lentokone korjattu`;
                break;
            case 'AIRCRAFT_REPAIR_BULK':
                message = `🔧 Lentokoneet korjattu`;
                break;
            case 'AIRCRAFT_UPGRADE':
                message = `⚙️ Lentokone päivitetty`;
                break;
            case 'BASE_UPGRADE':
                const lvl_from = payload.match(/from=([^;]+)/)?.[1] || '?';
                const lvl_to = payload.match(/to=([^;]+)/)?.[1] || '?';
                const cost = payload.match(/cost=([\d.]+)/)?.[1] || '0';
                message = `🏢 Tukikohta: ${lvl_from} → ${lvl_to} (-€${cost})`;
                break;
            case 'BILLS_PAID':
                const bill = payload.match(/amount=([\d.]+)/)?.[1] || '0';
                message = `💳 Kuukausilasku: -€${bill}`;
                break;
            case 'CASH_CHANGE':
                const delta = payload.match(/delta=([-\d.]+)/)?.[1] || '0';
                const context = payload.match(/context=([^;]+)/)?.[1] || 'UNKNOWN';
                const amount = Math.abs(parseFloat(delta)).toLocaleString('fi-FI', { maximumFractionDigits: 2 });
                
                let contextMsg = '';
                if (context === 'MONTHLY_BILL') {
                    contextMsg = `Kuukausilasku`;
                } else if (context === 'AIRCRAFT_ECO_UPGRADE') {
                    contextMsg = `Lentokone päivitetty`;
                } else if (context === 'BASE_UPGRADE') {
                    contextMsg = `Tukikohta päivitetty`;
                } else {
                    contextMsg = context;
                }
                
                message = `${delta.startsWith('-') ? '💸' : '💰'} ${contextMsg}: ${delta.startsWith('-') ? '-' : '+'}€${amount}`;
                break;
            default:
                message = payload || event.event_type;
        }
        
        entry.innerHTML = `<span class="log-time">${time}</span> ${message}`;
        logContainer.appendChild(entry);
    });
}

async function refreshEventLog() {
    console.log('Päivitetään tapahtumakylokii');
    await fetchEventLog(20);
}