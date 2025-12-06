let fleetData = [];
let filteredFleetData = [];
let currentSort = { column: null, ascending: true };
let activeFloatingMenu = null;
let baseCapacityData = [];

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
                <td class="callsign">${aircraft.model_name || '-'}</td>
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
                    <button class="btn-manage" onclick="toggleAircraftMenu(event, ${aircraft.aircraft_id})">
                        ⚙ MANAGE
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    document.getElementById('fleet-count').textContent = `${filteredFleetData.length} AIRCRAFT`;
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
            🔧 REPAIR
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
        showNotification('Не удалось загрузить данные самолёта', 'error');
    }
}

// Open repair modal
async function openRepairModal(aircraftId) {
    closeAircraftMenu();
    
    try {
        const response = await fetch(`/api/aircrafts/${aircraftId}`);
        if (!response.ok) throw new Error('Failed to fetch aircraft');
        
        const aircraft = await response.json();
        openRepairModalWindow(aircraft);
    } catch (error) {
        console.error('Failed to load aircraft details:', error);
        showNotification('Не удалось загрузить данные самолёта', 'error');
    }
}

function openRepairModalWindow(aircraft) {
    const modal = document.getElementById('aircraft-repair-modal');
    
    // Fill header
    document.getElementById('repair-aircraft-name').textContent = aircraft.model_name || 'Unknown';
    document.getElementById('repair-aircraft-reg').textContent = aircraft.registration || 'N/A';
    document.getElementById('repair-aircraft-condition').textContent = `CONDITION: ${aircraft.condition_percent}%`;
    
    // Build repair options grid
    renderRepairOptions(aircraft);
    
    // Show modal
    modal.classList.remove('hidden');
}

function closeRepairModal() {
    const modal = document.getElementById('aircraft-repair-modal');
    modal.classList.add('hidden');
}

function renderRepairOptions(aircraft) {
    const grid = document.getElementById('repair-options-grid');
    const currentCondition = aircraft.condition_percent || 0;
    
    // Repair options
    const repairOptions = [
        { 
            type: 'REPAIR 10%', 
            amount: 10, 
            cost: '$5 (PLACEHOLDER)', 
            icon: '🔧',
            benefits: ['Restore 10% condition', 'Quick maintenance'] 
        },
        { 
            type: 'REPAIR 20%', 
            amount: 20, 
            cost: '$5 (PLACEHOLDER)', 
            icon: '🔧',
            benefits: ['Restore 20% condition', 'Standard maintenance'] 
        },
        { 
            type: 'REPAIR 50%', 
            amount: 50, 
            cost: '$5 (PLACEHOLDER)', 
            icon: '🔧',
            benefits: ['Restore 50% condition', 'Major maintenance'] 
        },
        { 
            type: 'REPAIR TO 100%', 
            amount: 100 - currentCondition, 
            cost: '$5 (PLACEHOLDER)', 
            icon: '🔧',
            benefits: ['Full restoration', 'Complete overhaul'] 
        }
    ];
    
    grid.innerHTML = repairOptions.map((option, index) => {
        const targetCondition = Math.min(100, currentCondition + option.amount);
        const isMaxed = currentCondition >= 100;
        const canRepair = currentCondition < 100 && option.amount > 0;
        
        let buttonHtml = '';
        if (isMaxed) {
            buttonHtml = '<button class="eco-level-upgrade-btn active" disabled>✓ MAX CONDITION</button>';
        } else if (canRepair && targetCondition > currentCondition) {
            buttonHtml = `<button class="eco-level-upgrade-btn" onclick="performRepair(${aircraft.aircraft_id}, ${option.amount}, '${option.type}')">🔧 REPAIR</button>`;
        } else {
            buttonHtml = '<button class="eco-level-upgrade-btn" disabled>N/A</button>';
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
                    <div class="eco-level-cost-label">REPAIR COST</div>
                    <div class="eco-level-cost-value">
                        ${option.cost}
                    </div>
                </div>
                <div class="eco-level-benefits">
                    <div class="eco-level-benefits-title">BENEFITS</div>
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
    if (!confirm(`Confirm ${repairType} for $5?`)) return;
    
    try {
        const response = await fetch(`/api/aircrafts/${aircraftId}/repair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repair_amount: repairAmount })
        });
        
        if (!response.ok) {
            const error = await response.json();
            if (error.virhe === 'insufficient_funds') {
                showNotification('❌ Not enough cash for repair!', 'error');
            } else if (error.virhe === 'aircraft is busy (in flight)') {
                showNotification('❌ Cannot repair aircraft in flight!', 'error');
            } else {
                throw new Error(error.virhe || 'Repair failed');
            }
            return;
        }
        
        const result = await response.json();
        showNotification(`✓ Repair complete! Condition: ${result.previous_condition}% → ${result.new_condition}%`, 'success');
        
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
        showNotification(error.message || 'Repair failed', 'error');
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
    
    // ECO уровни 1-6
    const ecoLevels = [
        { level: 1, multiplier: '1.05×', cost: 'FREE (STARTER)', benefits: ['Earnings multiplier: 1.05×', 'Reduced fuel consumption'] },
        { level: 2, multiplier: '1.1×', cost: '$50 000', benefits: ['Earnings multiplier: 1.1×', 'Reduced fuel consumption'] },
        { level: 3, multiplier: '1.15×', cost: '$150 000', benefits: ['Earnings multiplier: 1.15×', 'Reduced fuel consumption'] },
        { level: 4, multiplier: '1.2×', cost: '$350 000', benefits: ['Earnings multiplier: 1.2×', 'Reduced fuel consumption'] },
        { level: 5, multiplier: '1.3×', cost: '$750 000', benefits: ['Earnings multiplier: 1.3×', 'Reduced fuel consumption'] },
        { level: 6, multiplier: '1.4×', cost: '$1 500 000', benefits: ['Earnings multiplier: 1.4×', 'Reduced fuel consumption'] }
    ];
    
    grid.innerHTML = ecoLevels.map(eco => {
        const isActive = eco.level <= currentLevel;
        const isNext = eco.level === nextLevel;
        const isLocked = eco.level > nextLevel;
        
        let buttonHtml = '';
        if (isActive) {
            buttonHtml = '<button class="eco-level-upgrade-btn active" disabled>✓ ACTIVE</button>';
        } else if (isNext) {
            const actualCost = aircraft.eco.next_upgrade_cost || eco.cost;
            buttonHtml = `<button class="eco-level-upgrade-btn" onclick="upgradeEcoLevel(${aircraft.aircraft_id}, ${eco.level})">↑ UPGRADE</button>`;
        } else {
            buttonHtml = '<button class="eco-level-upgrade-btn" disabled>🔒 LOCKED</button>';
        }
        
        return `
            <div class="eco-level-card ${isActive ? 'active' : ''} ${isLocked ? 'locked' : ''}">
                ${isLocked ? '<div class="eco-level-lock-icon">🔒</div>' : ''}
                <div class="eco-level-header">
                    <div class="eco-level-title">
                        <div class="eco-level-number">✈ ECO LEVEL ${eco.level}</div>
                    </div>
                    ${isActive ? '<div class="eco-level-badge active">✓ ACTIVE</div>' : ''}
                </div>
                <div class="eco-level-multiplier">${eco.multiplier} MULTIPLIER</div>
                <div class="eco-level-cost">
                    <div class="eco-level-cost-label">UPGRADE COST</div>
                    <div class="eco-level-cost-value ${eco.level === 1 ? 'free' : ''}">
                        ${isNext && aircraft.eco.next_upgrade_cost ? aircraft.eco.next_upgrade_cost : eco.cost}
                    </div>
                </div>
                <div class="eco-level-benefits">
                    <div class="eco-level-benefits-title">BENEFITS</div>
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
    if (!confirm(`Подтвердить апгрейд до ECO LEVEL ${targetLevel}?`)) return;
    
    try {
        const response = await fetch(`/api/aircrafts/${aircraftId}/upgrade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.virhe || 'Upgrade failed');
        }
        
        const result = await response.json();
        
        showNotification(`✓ Апгрейд завершён! Новый уровень: ${result.new_level}`, 'success');
        
        // Перезагрузить данные самолёта
        const aircraftResponse = await fetch(`/api/aircrafts/${aircraftId}`);
        const aircraft = await aircraftResponse.json();
        renderEcoLevels(aircraft);
        
        // Обновить Fleet Roster
        loadFleetData();
        
    } catch (error) {
        console.error('Upgrade failed:', error);
        showNotification(error.message || 'Апгрейд не удался', 'error');
    }
}

// Закрытие по Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeUpgradeModal();
        closeRepairModal();
        closeAircraftMenu();
    }
});

// Add new function to render capacity warnings
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