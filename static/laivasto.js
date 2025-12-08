let fleetData = [];
let filteredFleetData = [];
let currentSort = { column: null, ascending: true };
let activeFloatingMenu = null;
let baseCapacityData = [];

// Apufunktio lentokoneen tilan kääntämiseen suomeksi
function translateStatus(status) {
    switch (status) {
        case 'IDLE': return 'ODOTTAA';
        case 'IN_FLIGHT': return 'LENNOLLA';
        case 'RTB': return 'PALUUMATKALLA';
        case 'BUSY': return 'VARATTU';
        default: return status;
    }
}

// Load fleet data from API
async function loadFleetData() {
    try {
        // Load both fleet and base capacity data
        const [fleetResponse, capacityResponse] = await Promise.all([
            fetch('/api/aircrafts'),
            fetch('/api/bases/capacity')
        ]);
        
        if (!fleetResponse.ok) throw new Error('Failed to fetch fleet');
        if (!capacityResponse.ok) throw new Error('Failed to fetch capacity');
        
        const fleetResult = await fleetResponse.json();  // Renamed to avoid shadowing
        const capacityResult = await capacityResponse.json();  // Renamed for consistency
        
        fleetData = fleetResult.aircraft || [];  // Now assigns to module-level variable
        baseCapacityData = capacityResult.bases_capacity || [];
        filteredFleetData = [...fleetData];
        
        renderFleetTable();
        updateFleetStats();
        renderBaseCapacityWarnings();
    } catch (error) {
        console.error('Failed to load fleet:', error);
        document.getElementById('fleet-roster-list').innerHTML = 
            '<tr><td colspan="9" class="error-cell">❌ Lentokoneiden lataus epäonnistui</td></tr>';
    }
}

// Render fleet table
function renderFleetTable() {
    const tbody = document.getElementById('fleet-roster-list');
    
    if (filteredFleetData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Ei lentokoneita</td></tr>';
        document.getElementById('fleet-count').textContent = '0 KONETTA';
        return;
    }

    tbody.innerHTML = filteredFleetData.map(aircraft => {
        const conditionClass = aircraft.condition_percent >= 90 ? 'high' : 
                              aircraft.condition_percent >= 70 ? 'medium' : 'low';
        
        const statusClass = aircraft.status === 'IDLE' ? 'status-idle' :
                           aircraft.status === 'IN_FLIGHT' ? 'status-in-flight' : 'status-rtb';
        
        return `
            <tr class="aircraft-row">
                <td class="model-name">${aircraft.model_name || 'Tuntematon'}</td>
                <td class="registration">${aircraft.registration || 'N/A'}</td>
                <td class="callsign">${aircraft.model_name || '-'}</td>
                <td class="location">${aircraft.current_airport_ident || 'Tuntematon'}</td>
                <td>
                    <span class="${statusClass}">
                        ${translateStatus(aircraft.status) || 'ODOTTAA'}
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
                    <button class="btn-manage" onclick="toggleAircraftMenu(event, ${aircraft.aircraft_id})">
                        ⚙ HALLINTA
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    document.getElementById('fleet-count').textContent = `${filteredFleetData.length} KONETTA`;
}

// Toggle floating aircraft menu
function toggleAircraftMenu(event, aircraftId) {
    event.stopPropagation();
    
    // Close existing menu if clicking the same button
    if (activeFloatingMenu && activeFloatingMenu.dataset.aircraftId == aircraftId) {
        closeAircraftMenu();
        return;
    }
    
    // Close any existing menu
    closeAircraftMenu();
    
    const button = event.target;
    const buttonRect = button.getBoundingClientRect();
    
    // Create floating menu
    const menu = document.createElement('div');
    menu.className = 'aircraft-floating-menu';
    menu.dataset.aircraftId = aircraftId;
    
    menu.innerHTML = `
        <button class="aircraft-menu-btn eco-btn" onclick="openEcoUpgrade(${aircraftId})">
            ⚡ ECO
        </button>
        <button class="aircraft-menu-btn repair-btn" onclick="openRepairModal(${aircraftId})">
            🔧 KORJAA
        </button>
    `;
    
    // Position menu to the right of the button
    menu.style.position = 'fixed';
    menu.style.left = `${buttonRect.right + 10}px`;
    menu.style.top = `${buttonRect.top}px`;
    
    document.body.appendChild(menu);
    activeFloatingMenu = menu;
    
    // Add slight delay for animation
    setTimeout(() => menu.classList.add('visible'), 10);
}

// Close floating menu
function closeAircraftMenu() {
    if (activeFloatingMenu) {
        activeFloatingMenu.remove();
        activeFloatingMenu = null;
    }
}

// Open ECO upgrade modal
async function openEcoUpgrade(aircraftId) {
    closeAircraftMenu();
    
    try {
        const response = await fetch(`/api/aircrafts/${aircraftId}`);
        if (!response.ok) throw new Error('Failed to fetch aircraft');
        
        const aircraft = await response.json();
        openUpgradeModal(aircraft);
    } catch (error) {
        console.error('Failed to load aircraft details:', error);
        showNotification('Lentokoneen tietojen lataus epäonnistui', 'error');
    }
}

    // Avaa repair modal
async function openRepairModal(aircraftId) {
    closeAircraftMenu();
    
    try {
        const response = await fetch(`/api/aircrafts/${aircraftId}`);
        if (!response.ok) throw new Error('Failed to fetch aircraft');
        
        const aircraft = await response.json();
        openRepairModalWindow(aircraft);
    } catch (error) {
        console.error('Failed to load aircraft details:', error);
        showNotification('Lentokoneen tietojen lataus epäonnistui', 'error');
    }
}

function openRepairModalWindow(aircraft) {
    const modal = document.getElementById('aircraft-repair-modal');
    
    // Täytä header
    document.getElementById('repair-aircraft-name').textContent = aircraft.model_name || 'Tuntematon';
    document.getElementById('repair-aircraft-reg').textContent = aircraft.registration || 'N/A';
    document.getElementById('repair-aircraft-condition').textContent = `KUNTO: ${aircraft.condition_percent}%`;
    
    // Rakenna repair options -ruudukko
    renderRepairOptions(aircraft);
    
    // Näytä modal
    modal.classList.remove('hidden');
}

function closeRepairModal() {
    const modal = document.getElementById('aircraft-repair-modal');
    modal.classList.add('hidden');
}

function renderRepairOptions(aircraft) {
    const grid = document.getElementById('repair-options-grid');
    const currentCondition = aircraft.condition_percent || 0;
    
    // Korjaus vaihtoehdot
    const repairOptions = [
        { 
            type: 'KORJAA 10%', 
            amount: 10, 
            cost: '€5 (PAIKANNTÄYTE)', 
            icon: '🔧',
            benefits: ['Palauta 10% kuntoa', 'Nopea huolto'] 
        },
        { 
            type: 'KORJAA 20%', 
            amount: 20, 
            cost: '€5 (PAIKANNTÄYTE)', 
            icon: '🔧',
            benefits: ['Palauta 20% kuntoa', 'Tavallinen huolto'] 
        },
        { 
            type: 'KORJAA 50%', 
            amount: 50, 
            cost: '€5 (PAIKANNTÄYTE)', 
            icon: '🔧',
            benefits: ['Palauta 50% kuntoa', 'Päähuolto'] 
        },
        { 
            type: 'KORJAA 100%:IIN', 
            amount: 100 - currentCondition, 
            cost: '€5 (PAIKANNTÄYTE)', 
            icon: '🔧',
            benefits: ['Täysi korjaus', 'Kokonaisvaltainen kunnostus'] 
        }
    ];
    
    grid.innerHTML = repairOptions.map((option, index) => {
        const targetCondition = Math.min(100, currentCondition + option.amount);
        const isMaxed = currentCondition >= 100;
        const canRepair = currentCondition < 100 && option.amount > 0;
        
        let buttonHtml = '';
        if (isMaxed) {
            buttonHtml = '<button class="eco-level-upgrade-btn active" disabled>✓ MAKSIMI KUNTO</button>';
        } else if (canRepair && targetCondition > currentCondition) {
            buttonHtml = `<button class="eco-level-upgrade-btn" onclick="performRepair(${aircraft.aircraft_id}, ${option.amount}, '${option.type}')">🔧 KORJAA</button>`;
        } else {
            buttonHtml = '<button class="eco-level-upgrade-btn" disabled>EI SAATAVILLA</button>';
        }
        
        return `
            <div class="eco-level-card ${isMaxed ? 'active' : ''} ${!canRepair ? 'locked' : ''}">
                <div class="eco-level-header">
                    <div class="eco-level-title">
                        <div class="eco-level-number">${option.icon} ${option.type}</div>
                    </div>
                </div>
                <div class="eco-level-multiplier">${currentCondition}% → ${targetCondition}%</div>
                <div class="eco-level-cost">
                    <div class="eco-level-cost-label">KORJAUS HINTA</div>
                    <div class="eco-level-cost-value">
                        ${option.cost}
                    </div>
                </div>
                <div class="eco-level-benefits">
                    <div class="eco-level-benefits-title">EDUT</div>
                    <ul class="eco-level-benefits-list">
                        ${option.benefits.map(b => `<li>${b}</li>`).join('')}
                    </ul>
                </div>
                ${buttonHtml}
            </div>
        `;
    }).join('');
}

async function performRepair(aircraftId, repairAmount, repairType) {
    if (!confirm(`Vahvista ${repairType} hinnalla €5?`)) return;
    
    try {
        const response = await fetch(`/api/aircrafts/${aircraftId}/repair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repair_amount: repairAmount })
        });
        
        if (!response.ok) {
            const error = await response.json();
            if (error.virhe === 'insufficient_funds') {
                showNotification('❌ Ei tarpeeksi rahaa korjaukseen!', 'error');
            } else if (error.virhe === 'aircraft is busy (in flight)') {
                showNotification('❌ Ei voi korjata konetta lennolla!', 'error');
            } else {
                throw new Error(error.virhe || 'Korjaus epäonnistui');
            }
            return;
        }
        
        const result = await response.json();
        showNotification(`✓ Korjaus valmis! Kunto: ${result.previous_condition}% → ${result.new_condition}%`, 'success');
        
        // Reload aircraft data to update modal
        const aircraftResponse = await fetch(`/api/aircrafts/${aircraftId}`);
        const aircraft = await aircraftResponse.json();
        renderRepairOptions(aircraft);
        document.getElementById('repair-aircraft-condition').textContent = `CONDITION: ${aircraft.condition_percent}%`;
        
        // Update Fleet Roster table
        loadFleetData();
        
        // Update game stats in header
        if (typeof updateGameStats === 'function') {
            updateGameStats();
        }
        
    } catch (error) {
        console.error('Repair failed:', error);
        showNotification(error.message || 'Korjaus epäonnistui', 'error');
    }
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    if (activeFloatingMenu && !e.target.closest('.aircraft-floating-menu') && !e.target.closest('.btn-manage')) {
        closeAircraftMenu();
    }
});

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

    document.getElementById('total-fleet').textContent = `${totalFleet} KONETTA`;
    document.getElementById('idle-count').textContent = `${idleCount} VALMIINA`;
    document.getElementById('inflight-count').textContent = `${inflightCount} LENNOLLA`;
    document.getElementById('avg-condition').textContent = `${avgCondition}%`;
}

// Manage aircraft (placeholder)
function manageAircraft(aircraftId) {
    showNotification(`Koneen ${aircraftId} hallintapaneeli tulossa pian!`, 'success');
    console.log('Managing aircraft:', aircraftId);
}

// Auto-load when Laivasto view is shown
console.log('✈️ Laivasto module loaded');

function openUpgradeModal(aircraft) {
    const modal = document.getElementById('aircraft-upgrade-modal');
    
    // Заполнить заголовок
    document.getElementById('upgrade-aircraft-name').textContent = aircraft.model_name || 'Unknown';
    document.getElementById('upgrade-aircraft-reg').textContent = aircraft.registration || 'N/A';
    
    // Построить сетку ECO уровней
    renderEcoLevels(aircraft);
    
    // Показать модальное окно
    modal.classList.remove('hidden');
}

function closeUpgradeModal() {
    const modal = document.getElementById('aircraft-upgrade-modal');
    modal.classList.add('hidden');
}

function renderEcoLevels(aircraft) {
    const grid = document.getElementById('eco-levels-grid');
    const currentLevel = aircraft.eco.current_level || 0;
    const nextLevel = currentLevel + 1;
    
    // ECO tasot 1-6
    const ecoLevels = [
        { level: 1, multiplier: '1.05×', cost: 'ILMAINEN (ALOITUS)', benefits: ['Tulojen kerroin: 1.05×', 'Alentunut polttoainekulutus'] },
        { level: 2, multiplier: '1.1×', cost: '€50 000', benefits: ['Tulojen kerroin: 1.1×', 'Alentunut polttoainekulutus'] },
        { level: 3, multiplier: '1.15×', cost: '€150 000', benefits: ['Tulojen kerroin: 1.15×', 'Alentunut polttoainekulutus'] },
        { level: 4, multiplier: '1.2×', cost: '€350 000', benefits: ['Tulojen kerroin: 1.2×', 'Alentunut polttoainekulutus'] },
        { level: 5, multiplier: '1.3×', cost: '€750 000', benefits: ['Tulojen kerroin: 1.3×', 'Alentunut polttoainekulutus'] },
        { level: 6, multiplier: '1.4×', cost: '€1 500 000', benefits: ['Tulojen kerroin: 1.4×', 'Alentunut polttoainekulutus'] }
    ];
    
    grid.innerHTML = ecoLevels.map(eco => {
        const isActive = eco.level <= currentLevel;
        const isNext = eco.level === nextLevel;
        const isLocked = eco.level > nextLevel;
        
        let buttonHtml = '';
        if (isActive) {
            buttonHtml = '<button class="eco-level-upgrade-btn active" disabled>✓ AKTIIVINEN</button>';
        } else if (isNext) {
            const actualCost = aircraft.eco.next_upgrade_cost || eco.cost;
            buttonHtml = `<button class="eco-level-upgrade-btn" onclick="upgradeEcoLevel(${aircraft.aircraft_id}, ${eco.level})">↑ PÄIVITÄ</button>`;
        } else {
            buttonHtml = '<button class="eco-level-upgrade-btn" disabled>🔒 LUKITTU</button>';
        }
        
        return `
            <div class="eco-level-card ${isActive ? 'active' : ''} ${isLocked ? 'locked' : ''}">
                ${isLocked ? '<div class="eco-level-lock-icon">🔒</div>' : ''}
                <div class="eco-level-header">
                    <div class="eco-level-title">
                        <div class="eco-level-number">✈ ECO-TASO ${eco.level}</div>
                    </div>
                    ${isActive ? '<div class="eco-level-badge active">✓ AKTIIVINEN</div>' : ''}
                </div>
                <div class="eco-level-multiplier">${eco.multiplier} KERROIN</div>
                <div class="eco-level-cost">
                    <div class="eco-level-cost-label">PÄIVITYSHINTA</div>
                    <div class="eco-level-cost-value ${eco.level === 1 ? 'free' : ''}">
                        ${isNext && aircraft.eco.next_upgrade_cost ? aircraft.eco.next_upgrade_cost : eco.cost}
                    </div>
                </div>
                <div class="eco-level-benefits">
                    <div class="eco-level-benefits-title">EDUT</div>
                    <ul class="eco-level-benefits-list">
                        ${eco.benefits.map(b => `<li>${b}</li>`).join('')}
                    </ul>
                </div>
                ${buttonHtml}
            </div>
        `;
    }).join('');
}

async function upgradeEcoLevel(aircraftId, targetLevel) {
    if (!confirm(`Vahvista päivitys ECO LEVEL ${targetLevel}:iin?`)) return;
    
    try {
        const response = await fetch(`/api/aircrafts/${aircraftId}/upgrade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.virhe || 'Päivitys epäonnistui');
        }
        
        const result = await response.json();
        
        showNotification(`✓ Päivitys valmis! Uusi taso: ${result.new_level}`, 'success');
        
        // Lataa lentokoneen tiedot uudelleen
        const aircraftResponse = await fetch(`/api/aircrafts/${aircraftId}`);
        const aircraft = await aircraftResponse.json();
        renderEcoLevels(aircraft);
        
        // Päivitä Fleet Roster
        loadFleetData();
        
    } catch (error) {
        console.error('Upgrade failed:', error);
        showNotification(error.message || 'Päivitys epäonnistui', 'error');
    }
}

// Sulkeminen Escape-näppäimellä
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeUpgradeModal();
        closeRepairModal();
        closeAircraftMenu();
    }
});

// Lisää uusi funktio kapasiteettivaroitusten renderöintiin
function renderBaseCapacityWarnings() {
    const warningsContainer = document.getElementById('capacity-warnings');
    if (!warningsContainer) return;
    
    const warnings = baseCapacityData.filter(base => base.is_near_full || base.is_full);
    
    if (warnings.length === 0) {
        warningsContainer.innerHTML = '';
        warningsContainer.style.display = 'none';
        return;
    }
    
    warningsContainer.style.display = 'block';
    warningsContainer.innerHTML = warnings.map(base => {
        const warningClass = base.is_full ? 'capacity-full' : 'capacity-near-full';
        const icon = base.is_full ? '🔴' : '⚠️';
        const message = base.is_full 
            ? `TÄYNNÄ: ${base.base_name} (${base.base_ident})`
            : `LÄHES TÄYNNÄ: ${base.base_name} (${base.base_ident})`;
        
        return `
            <div class="capacity-warning ${warningClass}">
                <span class="capacity-icon">${icon}</span>
                <span class="capacity-text">${message}</span>
                <span class="capacity-count">${base.current_count}/${base.max_capacity} konetta</span>
            </div>
        `;
    }).join('');
}