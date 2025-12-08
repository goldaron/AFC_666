// tukikohdat.js - Base Management Module

let basesData = [];

// Base level configuration
const BASE_LEVELS = {
    'SMALL': { slots: 2, name: 'Pieni', icon: '🏪' },
    'MEDIUM': { slots: 5, name: 'Keskikokoinen', icon: '🏢' },
    'LARGE': { slots: 10, name: 'Suuri', icon: '🏭' },
    'HUGE': { slots: 20, name: 'Valtava', icon: '🏰' }
};

const UPGRADE_COSTS = {
    'SMALL_TO_MEDIUM': 0.50,
    'MEDIUM_TO_LARGE': 0.90,
    'LARGE_TO_HUGE': 1.50
};

// Load bases data
async function loadBasesData() {
    try {
        const response = await fetch('/api/bases');
        if (!response.ok) throw new Error('Failed to fetch bases');
        
        const data = await response.json();
        basesData = data.owned_bases || [];
        
        console.log('Loaded bases:', basesData); // Debug
        renderBasesGrid();
    } catch (error) {
        console.error('Failed to load bases:', error);
        document.getElementById('bases-grid').innerHTML = 
            '<div class="error-msg">❌ Tukikohtien lataus epäonnistui</div>';
    }
}

// Render bases grid
function renderBasesGrid() {
    const grid = document.getElementById('bases-grid');
    
    if (!basesData || basesData.length === 0) {
        grid.innerHTML = `
            <div class="no-bases-warning">
                <div class="no-bases-icon">🏢</div>
                <div class="no-bases-text">EI TUKIKOHTIA</div>
            </div>
        `;
        return;
    }

    grid.innerHTML = basesData.map(base => {
        const currentLevel = base.current_level || 'SMALL';
        const levelInfo = BASE_LEVELS[currentLevel];
        const levelIndex = Object.keys(BASE_LEVELS).indexOf(currentLevel);
        const canUpgrade = levelIndex < Object.keys(BASE_LEVELS).length - 1;
        const nextLevel = canUpgrade ? Object.keys(BASE_LEVELS)[levelIndex + 1] : null;
        const nextLevelInfo = nextLevel ? BASE_LEVELS[nextLevel] : null;
        
        // Calculate upgrade cost
        let upgradeCost = null;
        if (canUpgrade && base.purchase_cost) {
            const costKey = `${currentLevel}_TO_${nextLevel}`;
            const pct = UPGRADE_COSTS[costKey];
            upgradeCost = (parseFloat(base.purchase_cost) * pct).toFixed(2);
        }

        return `
            <div class="base-card">
                <div class="base-card-header">
                    <div class="base-card-icon">${levelInfo.icon}</div>
                    <div class="base-card-title-block">
                        <div class="base-card-name">${base.base_name || base.base_ident}</div>
                        <div class="base-card-ident">${base.base_ident}</div>
                    </div>
                </div>

                <div class="base-card-body">
                    <!-- Current Level -->
                    <div class="base-level-section">
                        <div class="base-section-label">NYKYINEN TASO</div>
                        <div class="base-level-display current">
                            <div class="base-level-badge">${levelInfo.name.toUpperCase()}</div>
                            <div class="base-level-detail">
                                <span class="base-level-icon">✈️</span>
                                <span>${levelInfo.slots} LENTOKONETTA</span>
                            </div>
                        </div>
                    </div>

                    ${canUpgrade ? `
                        <!-- Upgrade Arrow -->
                        <div class="base-upgrade-arrow">↓</div>

                        <!-- Next Level -->
                        <div class="base-level-section">
                            <div class="base-section-label">PÄIVITYKSEN JÄLKEEN</div>
                            <div class="base-level-display next">
                                <div class="base-level-badge next">${nextLevelInfo.name.toUpperCase()}</div>
                                <div class="base-level-detail">
                                    <span class="base-level-icon">✈️</span>
                                    <span>${nextLevelInfo.slots} LENTOKONETTA</span>
                                </div>
                            </div>
                        </div>

                        <!-- Upgrade Section -->
                        <div class="base-upgrade-section">
                            <div class="base-upgrade-cost">
                                <span class="base-upgrade-label">PÄIVITYKSEN HINTA</span>
                                <span class="base-upgrade-price">€${parseFloat(upgradeCost).toLocaleString()}</span>
                            </div>
                            <button class="base-upgrade-btn" onclick="upgradeBase(${base.base_id}, '${currentLevel}', '${nextLevel}', ${upgradeCost})">
                                ↑ PÄIVITÄ TUKIKOHTAA
                            </button>
                        </div>
                    ` : `
                        <!-- Max Level -->
                        <div class="base-max-level">
                            <div class="base-max-badge">✓ MAKSIMITASO SAAVUTETTU</div>
                        </div>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

// Upgrade base
async function upgradeBase(baseId, currentLevel, nextLevel, cost) {
    if (!confirm(`Vahvista tukikohdan päivitys tasolle ${BASE_LEVELS[nextLevel].name} hintaan €${parseFloat(cost).toLocaleString()}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/bases/${baseId}/upgrade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true })
        });

        if (!response.ok) {
            const error = await response.json();
            if (error.virhe === 'insufficient_funds') {
                showNotification('❌ Ei tarpeeksi rahaa päivitykseen!', 'error');
            } else if (error.virhe === 'already_max') {
                showNotification('❌ Tukikohta on jo maksimitasolla!', 'error');
            } else {
                throw new Error(error.virhe || 'Päivitys epäonnistui');
            }
            return;
        }

        const result = await response.json();
        showNotification(`✓ Tukikohta päivitetty tasolle ${BASE_LEVELS[result.to].name}!`, 'success');

        // Reload bases data
        loadBasesData();

        // Update game stats in header
        if (typeof updateGameStats === 'function') {
            updateGameStats();
        }

    } catch (error) {
        console.error('Base upgrade failed:', error);
        showNotification(error.message || 'Päivitys epäonnistui', 'error');
    }
}

// ============================================
// BROWSE BASES MODAL
// ============================================

let availableBasesData = [];
let filteredAvailableBases = [];

// Country code to flag emoji mapping
function countryToFlag(countryCode) {
    if (!countryCode || countryCode.length !== 2) return '🌍';
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

// Open browse bases modal
async function openBrowseBasesModal() {
    const modal = document.getElementById('browse-bases-modal');
    modal.classList.remove('hidden');
    
    // Load available bases
    await loadAvailableBases();
}

// Close browse bases modal
function closeBrowseBasesModal() {
    const modal = document.getElementById('browse-bases-modal');
    modal.classList.add('hidden');
    
    // Clear search
    document.getElementById('base-search-input').value = '';
}

// Load available bases from API
async function loadAvailableBases() {
    const grid = document.getElementById('available-bases-grid');
    grid.innerHTML = '<div class="loading">Ladataan sijainteja...</div>';
    
    try {
        const response = await fetch('/api/bases/available');
        if (!response.ok) throw new Error('Failed to fetch available bases');
        
        const data = await response.json();
        availableBasesData = data.available_bases || [];
        filteredAvailableBases = [...availableBasesData];
        
        renderAvailableBases();
    } catch (error) {
        console.error('Failed to load available bases:', error);
        grid.innerHTML = '<div class="error-msg">❌ Sijaintien lataus epäonnistui</div>';
    }
}

// Filter available bases
function filterAvailableBases() {
    const searchTerm = document.getElementById('base-search-input').value.toLowerCase();
    
    if (!searchTerm) {
        filteredAvailableBases = [...availableBasesData];
    } else {
        filteredAvailableBases = availableBasesData.filter(base => 
            (base.name && base.name.toLowerCase().includes(searchTerm)) ||
            (base.ident && base.ident.toLowerCase().includes(searchTerm)) ||
            (base.country && base.country.toLowerCase().includes(searchTerm)) ||
            (base.municipality && base.municipality.toLowerCase().includes(searchTerm))
        );
    }
    
    renderAvailableBases();
}

// Render available bases grid
function renderAvailableBases() {
    const grid = document.getElementById('available-bases-grid');
    
    if (!filteredAvailableBases || filteredAvailableBases.length === 0) {
        grid.innerHTML = `
            <div class="no-bases-available">
                <div class="no-bases-available-icon">🔍</div>
                <div class="no-bases-available-text">Ei löytynyt sijainteja</div>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = filteredAvailableBases.map(base => {
        const flag = countryToFlag(base.country);
        const price = parseFloat(base.purchase_price || 0);
        
        return `
            <div class="available-base-card">
                <div class="available-base-header">
                    <div class="available-base-info">
                        <div class="available-base-name">${base.name || 'Unknown Airport'}</div>
                        <div class="available-base-ident">${base.ident || '-'}</div>
                    </div>
                    <div class="available-base-country">
                        <span class="available-base-country-flag">${flag}</span>
                        <span class="available-base-country-code">${base.country || '-'}</span>
                    </div>
                </div>
                
                <div class="available-base-details">
                    <div class="available-base-detail">
                        <div class="available-base-detail-label">HINTA</div>
                        <div class="available-base-detail-value price">€${price.toLocaleString()}</div>
                    </div>
                    <div class="available-base-detail">
                        <div class="available-base-detail-label">KAPASITEETTI</div>
                        <div class="available-base-detail-value capacity">✈️ ${base.max_capacity} konetta</div>
                    </div>
                </div>
                
                <button class="available-base-buy-btn" onclick="buyBase('${base.ident}', '${(base.name || '').replace(/'/g, "\\'")}', ${price})">
                    🛒 OSTA TUKIKOHTA
                </button>
            </div>
        `;
    }).join('');
}

// Buy a base
async function buyBase(ident, name, price) {
    if (!confirm(`Haluatko ostaa tukikohdan ${name} (${ident}) hintaan €${price.toLocaleString()}?`)) {
        return;
    }
    
    try {
        const response = await fetch('/api/bases/buy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ident: ident })
        });
        
        if (!response.ok) {
            const error = await response.json();
            if (error.virhe === 'insufficient_funds') {
                showNotification('❌ Ei tarpeeksi rahaa ostoon!', 'error');
            } else if (error.virhe === 'already_owned') {
                showNotification('❌ Omistat jo tämän tukikohdan!', 'error');
            } else {
                throw new Error(error.virhe || 'Osto epäonnistui');
            }
            return;
        }
        
        const result = await response.json();
        showNotification(`✓ Tukikohta ${result.base_name} ostettu!`, 'success');
        
        // Close modal and reload data
        closeBrowseBasesModal();
        loadBasesData();
        
        // Update game stats in header
        if (typeof updateGameStats === 'function') {
            updateGameStats();
        }
        
    } catch (error) {
        console.error('Base purchase failed:', error);
        showNotification(error.message || 'Osto epäonnistui', 'error');
    }
}

console.log('🏢 Tukikohdat module loaded');