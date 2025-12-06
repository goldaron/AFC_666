
let fleetData = [];
let filteredFleetData = [];
let currentSort = { column: null, ascending: true };

// Load fleet data from API
async function loadFleetData() {
    try {
        const response = await fetch('/api/aircrafts');
        if (!response.ok) throw new Error('Failed to fetch fleet');
        
        const data = await response.json();
        fleetData = data.aircraft || [];
        filteredFleetData = [...fleetData];
        
        renderFleetTable();
        updateFleetStats();
    } catch (error) {
        console.error('Failed to load fleet:', error);
        document.getElementById('fleet-roster-list').innerHTML = 
            '<tr><td colspan="8" class="error-cell">❌ Lentokoneiden lataus epäonnistui</td></tr>';
    }
}

// Render fleet table
function renderFleetTable() {
    const tbody = document.getElementById('fleet-roster-list');
    
    if (filteredFleetData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Ei lentokoneita</td></tr>';
        document.getElementById('fleet-count').textContent = '0 AIRCRAFT';
        return;
    }

    tbody.innerHTML = filteredFleetData.map(aircraft => {
        const conditionClass = aircraft.condition_percent >= 90 ? 'high' : 
                              aircraft.condition_percent >= 70 ? 'medium' : 'low';
        
        const statusClass = aircraft.status === 'IDLE' ? 'status-idle' :
                           aircraft.status === 'IN_FLIGHT' ? 'status-in-flight' : 'status-rtb';
        
        return `
            <tr class="aircraft-row">
                <td class="model-name">${aircraft.model_name || 'Unknown'}</td>
                <td class="registration">${aircraft.registration || 'N/A'}</td>
                <td class="location">${aircraft.current_airport_ident || 'Unknown'}</td>
                <td>
                    <span class="${statusClass}">
                        ${aircraft.status || 'IDLE'}
                    </span>
                </td>
                <td class="condition-cell">
                    <div class="condition-bar">
                        <div class="condition-fill ${conditionClass}" 
                             style="width: ${aircraft.condition_percent}%">
                        </div>
                    </div>
                    <span class="condition-text">${aircraft.condition_percent}%</span>
                </td>
                <td class="eco-level">
                    ✈ LV ${aircraft.eco_level || 0}
                </td>
                <td class="multiplier-cell">${aircraft.effective_eco || '1.0'}×</td>
                <td>
                    <button class="btn-manage" onclick="manageAircraft(${aircraft.aircraft_id})">
                        ⚙ MANAGE
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    document.getElementById('fleet-count').textContent = `${filteredFleetData.length} AIRCRAFT`;
}

// Sort table
function sortFleetTable(column) {
    if (currentSort.column === column) {
        currentSort.ascending = !currentSort.ascending;
    } else {
        currentSort.column = column;
        currentSort.ascending = true;
    }

    filteredFleetData.sort((a, b) => {
        let aVal = a[column];
        let bVal = b[column];

        if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        }

        if (aVal < bVal) return currentSort.ascending ? -1 : 1;
        if (aVal > bVal) return currentSort.ascending ? 1 : -1;
        return 0;
    });

    renderFleetTable();
    updateSortIndicators();
}

// Update sort indicators
function updateSortIndicators() {
    document.querySelectorAll('.fleet-table .sortable').forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
    });
    
    const activeHeader = document.querySelector(`.fleet-table .sortable[onclick*="${currentSort.column}"]`);
    if (activeHeader) {
        activeHeader.classList.add(currentSort.ascending ? 'sorted-asc' : 'sorted-desc');
    }
}

// Filter fleet
function filterFleet() {
    const searchTerm = document.getElementById('fleet-search').value.toLowerCase();
    const statusFilter = document.getElementById('fleet-status-filter').value;

    filteredFleetData = fleetData.filter(aircraft => {
        const matchesSearch = 
            (aircraft.model_name && aircraft.model_name.toLowerCase().includes(searchTerm)) ||
            (aircraft.registration && aircraft.registration.toLowerCase().includes(searchTerm)) ||
            (aircraft.current_airport_ident && aircraft.current_airport_ident.toLowerCase().includes(searchTerm));

        const matchesStatus = statusFilter === 'all' || aircraft.status === statusFilter;

        return matchesSearch && matchesStatus;
    });

    renderFleetTable();
    updateFleetStats();
}

// Update fleet statistics
function updateFleetStats() {
    const totalFleet = fleetData.length;
    const idleCount = fleetData.filter(a => a.status === 'IDLE').length;
    const inflightCount = fleetData.filter(a => a.status === 'IN_FLIGHT').length;
    const avgCondition = totalFleet > 0 ? Math.round(
        fleetData.reduce((sum, a) => sum + (a.condition_percent || 0), 0) / totalFleet
    ) : 0;

    document.getElementById('total-fleet').textContent = `${totalFleet} AIRCRAFT`;
    document.getElementById('idle-count').textContent = `${idleCount} READY`;
    document.getElementById('inflight-count').textContent = `${inflightCount} ACTIVE`;
    document.getElementById('avg-condition').textContent = `${avgCondition}%`;
}

// Manage aircraft (placeholder)
function manageAircraft(aircraftId) {
    showNotification(`Koneen ${aircraftId} hallintapaneeli tulossa pian!`, 'success');
    console.log('Managing aircraft:', aircraftId);
}

// Auto-load when Laivasto view is shown
console.log('✈️ Laivasto module loaded');