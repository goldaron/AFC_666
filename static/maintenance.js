// Huolto-näkymän logiikka (Maintenance Hangar)
// Näyttää laivastosta lentokoneita joita pitää korjata ja hallinnoi kunnon tietoja

async function loadMaintenanceView() {
    try {
        // Hae lentokoneet käyttäen apiCall-funktiota
        const data = await apiCall('/api/aircrafts');
        const aircrafts = data.aircraft || [];
        
        if (!Array.isArray(aircrafts)) {
            console.error('Unexpected aircrafts response:', aircrafts);
            return;
        }

        // Laske KPI:t
        let needsService = 0;
        let critical = 0;
        let totalRepairCost = 0;
        let operational = 0;

        const maintenanceQueue = [];

        aircrafts.forEach(aircraft => {
            const condition = aircraft.condition_percent || 100;
            
            // Luokittele koneen kunto
            if (condition < 70) needsService++;
            if (condition < 50) critical++;
            if (condition >= 90) operational++;

            // Laske korjauskustannus
            // Arvioidaan hinta samalla kaavalla kuin backendissä (REPAIR_COST_PER_PERCENT = 500)
            const repairCost = (100 - condition) * 500; 
            totalRepairCost += repairCost;

            // Määritä prioriteetti
            let priority = 'ALHAINEN';
            let priorityClass = 'low';
            if (condition < 50) {
                priority = 'KRIITTINEN';
                priorityClass = 'critical';
            } else if (condition < 70) {
                priority = 'KORKEA';
                priorityClass = 'high';
            } else if (condition < 85) {
                priority = 'KESKITASO';
                priorityClass = 'medium';
            }

            // Laske korjausaika (tunneissa)
            const repairTime = Math.ceil((100 - condition) / 5);

            maintenanceQueue.push({
                model: aircraft.model_name || 'Unknown',
                registration: aircraft.registration || 'N/A',
                callsign: aircraft.model_name || 'N/A',
                location: aircraft.current_airport_ident || 'Unknown',
                condition: condition,
                priority: priority,
                priorityClass: priorityClass,
                repairCost: repairCost,
                repairTime: repairTime,
                aircraftId: aircraft.aircraft_id
            });
        });

        // Päivitä KPI-näytöt
        document.getElementById('needs-service-count').textContent = needsService;
        document.getElementById('critical-count').textContent = critical;
        document.getElementById('total-cost').textContent = '€' + formatMoney(totalRepairCost);
        document.getElementById('operational-count').textContent = operational;

        // Päivitä BULK MAINTENANCE -kustannukset
        document.getElementById('bulk-total-cost').textContent = '€' + formatMoney(totalRepairCost);
        
        // Päivitä SERVICE QUEUE -laskuri
        document.getElementById('queue-aircraft-count').textContent = `${needsService} KONETTA`;

        // Täytä SERVICE QUEUE -taulukko
        const tbody = document.getElementById('maintenance-queue-tbody');
        tbody.innerHTML = '';

        maintenanceQueue
            .filter(a => a.condition < 100) // Näytä vain koneet jotka tarvitsevat huoltoa
            .sort((a, b) => a.condition - b.condition) // Järjestä huonoimman kunnan mukaan
            .forEach(aircraft => {
                const row = document.createElement('tr');
                const conditionPercent = Math.round(aircraft.condition);
                
                // Määritä condition-väri
                let conditionColor = '#05df72'; // green
                let conditionTextColor = 'green';
                if (conditionPercent < 50) {
                    conditionColor = '#ff6900';
                    conditionTextColor = 'orange';
                } else if (conditionPercent < 70) {
                    conditionColor = '#f0b100';
                    conditionTextColor = 'amber';
                }

                row.innerHTML = `
                    <td>${aircraft.model}</td>
                    <td>${aircraft.registration}</td>
                    <td>${aircraft.callsign}</td>
                    <td>${aircraft.location}</td>
                    <td>
                        <div class="queue-table-condition">
                            <div class="condition-bar">
                                <div class="condition-bar-fill" style="width: ${conditionPercent}%; background: ${conditionColor};"></div>
                            </div>
                            <span class="condition-text ${conditionTextColor}">${conditionPercent}%</span>
                        </div>
                    </td>
                    <td>
                        <span class="priority-badge ${aircraft.priorityClass}">
                            ${'●'.repeat(aircraft.priority === 'KRIITTINEN' ? 3 : aircraft.priority === 'KORKEA' ? 2 : 1)} ${aircraft.priority}
                        </span>
                    </td>
                    <td class="cost-cell">€${formatMoney(aircraft.repairCost)}</td>
                    <td class="time-cell">
                        <svg class="time-icon" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="12" r="10"></circle>
                            <path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" fill="none"></path>
                        </svg>
                        ${aircraft.repairTime}H
                    </td>
                    <td>
                        <button class="repair-action-btn" onclick="repairAircraft(${aircraft.aircraftId})">
                            <svg class="repair-icon" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"></path>
                            </svg>
                            KORJAA
                        </button>
                    </td>
                `;
                tbody.appendChild(row);
            });

    } catch (error) {
        console.error('Maintenance view load error:', error);
    }
}

async function repairAircraft(aircraftId) {
    try {
        const result = await apiCall(`/api/aircrafts/${aircraftId}/repair`, {
            method: 'POST',
            body: JSON.stringify({ repair_type: 'full' })
        });

        showNotification(`✅ ${result.viesti || 'Kone korjattu onnistuneesti!'}`, 'success');
        loadMaintenanceView(); // Päivitä näkymä
    } catch (error) {
        console.error('Repair error:', error);
        showNotification('Korjaus epäonnistui', 'error');
    }
}

async function repairAllAircraft() {
    if (!confirm('Oletko varma? Tämä korjaa KAIKKI lentokoneet 100%:iin.')) return;

    try {
        // Haetaan koneet uudelleen varmuuden vuoksi
        const data = await apiCall('/api/aircrafts');
        const aircrafts = data.aircraft || [];

        let totalRepaired = 0;
        let totalCost = 0;

        // Huom: Tämä on hidas tapa, mutta toimii. Oikeasti pitäisi olla backend endpoint /api/aircrafts/repair-all
        for (const aircraft of aircrafts) {
            if (aircraft.condition_percent < 100) {
                try {
                    await apiCall(`/api/aircrafts/${aircraft.aircraft_id}/repair`, {
                        method: 'POST',
                        body: JSON.stringify({ repair_type: 'full' })
                    });
                    totalRepaired++;
                    totalCost += (100 - aircraft.condition_percent) * 500;
                } catch (e) {
                    console.error(`Failed to repair ${aircraft.registration}`, e);
                }
            }
        }

        showNotification(`✅ ${totalRepaired} konetta korjattu! Arvioitu hinta: €${formatMoney(totalCost)}`, 'success');
        loadMaintenanceView(); // Päivitä näkymä
    } catch (error) {
        console.error('Bulk repair error:', error);
        showNotification('Joukkokorjaus epäonnistui', 'error');
    }
}

// CSS-fix näytölle
function fixMaintenanceTableDisplay() {
    const tbody = document.getElementById('maintenance-queue-tbody');
    const rows = tbody?.querySelectorAll('tr');
    
    rows?.forEach(row => {
        const cells = row.querySelectorAll('td');
        cells.forEach((cell, index) => {
            if (index === 4) { // Condition column
                cell.style.display = 'flex';
                cell.style.alignItems = 'center';
                cell.style.gap = '8px';
                cell.style.whiteSpace = 'nowrap';
            }
        });
    });
}

// Apu-funktio rahan muotoiluun (normalisoitu app.js:n kanssa)
function formatMoney(amount) {
    if (!amount) return '0';
    return Math.round(amount).toLocaleString('fi-FI');
}