/**
 * map.js - Maailmankartan näkymä (Developer 4 / Kehittäjä 4)
 * 
 * Näyttää karttanäkymän, jossa visualisoidaan:
 * - Lennolla olevat koneet ja niiden reitit
 * - Lähtökohta (harmaa merkki)
 * - Loppukohta (sininen merkki)
 * - Reitin viiva (sininen katkoviiva)
 * 
 * Optimoinnit käytössä:
 * - Kartan alustus vain kerran (mapInitialized flag)
 * - API-datan välimuistitus (mapDataCache)
 * - Vain tehtävän kohteet näytetään (ei kaikkia lentokenttiä)
 * - Duplikaatit poistetaan drawnOrigins/drawnDestinations seteillä
 * 
 * Endpointit:
 * - GET /api/tasks → aktiivisten sopimusten haku kartanäkymää varten
 */

/**
 * map.js - Maailmankartan näkymä (optimoitu)
 * Näyttää VAIN tehtävällä olevat koneet, niiden lähtö ja loppupisteet, sekä reitit
 * - Lähtöpisteet: harmaa, hehkuva
 * - Loppupisteet: sininen, hehkuva  
 * - Reitit: sininen katkoviiva
 * 
 * OPTIMOINNIT:
 * - Kartan alustus vain kerran (mapInitialized flag)
 * - Välimuisti API-datalle (mapDataCache)
 * - Ei kaikkia lentokenttiä, vain tehtävän kohteet
 * - Duplikaatit poistettu drawnOrigins/drawnDestinations seteillä
 */

let mapInstance = null;
let mapMarkers = [];
let mapPolylines = [];
let mapDataCache = null;
let mapInitialized = false;

/**
 * Alustaa kartan ja lataa lennon tiedot
 */
async function initializeMap() {
    const mapContainer = document.getElementById('map-container');
    
    try {
        // Tarkistetaan että Leaflet on ladattu
        if (typeof L === 'undefined') {
            console.error('Leaflet kirjasto ei ole ladattu');
            mapContainer.innerHTML = '<div class="error-state">Karttakirjasto ei ole käytettävissä</div>';
            return;
        }
        
        // Luodaan kartta vain kerran (ei uudelleeninitialisointia)
        if (!mapInitialized) {
            mapInstance = L.map('map-container').setView([20, 0], 2);
            
            // Lisätään taustakartta (Dark karttataso)
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '© OpenStreetMap contributors © CARTO',
                maxZoom: 19,
                opacity: 0.8
            }).addTo(mapInstance);
            
            mapInitialized = true;
        }
        
        // Puhdistetaan vanhat markerit ja linjat
        clearMapMarkers();
        
        // Haetaan kartan tiedot
        const mapData = await apiCall('/api/map-data');
        
        if (!mapData || !mapData.activeContracts || mapData.activeContracts.length === 0) {
            console.warn('Ei aktiivisia lentoja');
            const listContainer = document.getElementById('active-flights-list');
            if (listContainer) {
                listContainer.innerHTML = '<div class="empty-state">Ei aktiivisia lentoja</div>';
            }
            return;
        }
        
        // Tallennetaan data välimuistiin
        mapDataCache = mapData;
        
        // Piirretään aktiiviset lennot (lähtöpisteet harmaina, loppupisteet sinisina, viivat sinisiä)
        drawActiveFlights(mapData.activeContracts);
        
        // Piirretään pääkotisatama erityisellä ikonilla
        if (mapData.headquartersIdent) {
            drawHeadquarters(mapData.airports, mapData.headquartersIdent);
        }
        
        // Päivitään alempi lista aktiivisista lennoista
        displayActiveFlyingList(mapData.activeContracts, mapData.currentDay);
        
    } catch (error) {
        console.error('Kartan lataus epäonnistui:', error);
        mapContainer.innerHTML = '<div class="error-state">❌ Kartan lataus epäonnistui: ' + error.message + '</div>';
        showNotification('Kartan lataus epäonnistui', 'error');
    }
}

/**
 * Tyhjentää kaikki markerit ja linjat kartalta
 */
function clearMapMarkers() {
    mapMarkers.forEach(marker => {
        if (mapInstance) mapInstance.removeLayer(marker);
    });
    mapMarkers = [];
    
    mapPolylines.forEach(line => {
        if (mapInstance) mapInstance.removeLayer(line);
    });
    mapPolylines = [];
}

/**
 * Piirtää aktiiviset lennot kartalle viivaina ja päätepisteinä
 * Optimoitu: näyttää VAIN tehtävällä olevien koneiden reitit
 * @param {Array} activeContracts - Lista aktiivisista sopimuksista
 */
function drawActiveFlights(activeContracts) {
    if (!activeContracts || activeContracts.length === 0) return;
    
    // Seurataan mitä lentokenttiä olemme jo piirtäneet (välttää duplikaatit)
    const drawnOrigins = new Set();
    const drawnDestinations = new Set();
    const hasEventFlights = new Set();
    
    activeContracts.forEach((contract) => {
        const from = [contract.originLat, contract.originLon];
        const to = [contract.destLat, contract.destLon];
        
        // Piirretään lähtöpiste (harmaa, hehkuva)
        if (!drawnOrigins.has(contract.originIdent)) {
            const originMarker = L.circleMarker(from, {
                radius: 7,
                fillColor: '#888888', // Harmaa lähtöpiste
                fillOpacity: 0.9,
                stroke: true,
                weight: 2,
                color: '#666666',
                className: 'marker-origin'
            });
            
            const originPopup = `
                <div class="flight-popup">
                    <strong>${contract.originIdent}</strong><br>
                    ${contract.originName}<br>
                    <span style="font-size: 12px; color: #aaa;">Lähtöpiste</span>
                </div>
            `;
            originMarker.bindPopup(originPopup);
            originMarker.addTo(mapInstance);
            mapMarkers.push(originMarker);
            
            drawnOrigins.add(contract.originIdent);
        }
        
        // Piirretään loppupiste (sininen, hehkuva)
        if (!drawnDestinations.has(contract.destIdent)) {
            const destMarker = L.circleMarker(to, {
                radius: 8,
                fillColor: '#00d4ff', // Syaani/sininen loppupiste
                fillOpacity: 0.95,
                stroke: true,
                weight: 2.5,
                color: '#00a8cc',
                className: 'marker-destination'
            });
            
            const destPopup = `
                <div class="flight-popup">
                    <strong>${contract.destIdent}</strong><br>
                    ${contract.destName}<br>
                    <span style="font-size: 12px; color: #00d4ff;">Määräpiste</span>
                </div>
            `;
            destMarker.bindPopup(destPopup);
            destMarker.addTo(mapInstance);
            mapMarkers.push(destMarker);
            
            drawnDestinations.add(contract.destIdent);
        }
        
        // Piirretään viiva (sininen katkoviiva, hehkuva)
        const polyline = L.polyline([from, to], {
            color: '#00d4ff', // Hehkuva sininen
            weight: 2.5,
            opacity: 0.8,
            dashArray: '6, 4', // Katkoviiva
            lineCap: 'round',
            lineJoin: 'round'
        });
        
        const linePopup = `
            <div class="flight-popup">
                <strong>${contract.aircraft}</strong><br>
                ${contract.originIdent} → ${contract.destIdent}<br>
                Edistyminen: ${contract.progressPercent}%
            </div>
        `;
        polyline.bindPopup(linePopup);
        polyline.addTo(mapInstance);
        mapPolylines.push(polyline);
        
        // Piirretään lentokoneen ikoni viivalla progressin mukaiselle kohdalle
        const progressRatio = Math.min(Math.max(contract.progressPercent / 100, 0), 1);
        const aircraftLat = from[0] + (to[0] - from[0]) * progressRatio;
        const aircraftLon = from[1] + (to[1] - from[1]) * progressRatio;
        
        const aircraftMarker = L.marker([aircraftLat, aircraftLon], {
            icon: L.divIcon({
                html: '<div style="font-size: 24px; filter: drop-shadow(0 0 4px #00d4ff);">✈️</div>',
                iconSize: [24, 24],
                className: 'aircraft-icon'
            })
        });
        
        const aircraftPopup = `
            <div class="flight-popup">
                <strong>${contract.aircraft}</strong><br>
                <strong>${contract.progressPercent}%</strong> lentää<br>
                ${contract.originIdent} → ${contract.destIdent}
            </div>
        `;
        aircraftMarker.bindPopup(aircraftPopup);
        aircraftMarker.addTo(mapInstance);
        mapMarkers.push(aircraftMarker);
        
        // Tarkistetaan onko lennolla event ja näytetään varoitus
        checkFlightEvent(contract, aircraftLat, aircraftLon);
    });
}

/**
 * Tarkistaa lennolla olevan eventin ja näyttää varoitusmerkkerin
 * @param {Object} contract - Lentosopimus
 * @param {Number} aircraftLat - Lentokoneen leveysaste
 * @param {Number} aircraftLon - Lentokoneen pituusaste
 */
function checkFlightEvent(contract, aircraftLat, aircraftLon) {
    // Tarkistaan onko lennolla event_id
    if (contract.event_id && contract.event_id > 0) {
        // Näytetään punainen varoitusmerkki
        const eventMarker = L.marker([aircraftLat, aircraftLon], {
            icon: L.divIcon({
                html: '<div style="font-size: 20px; filter: drop-shadow(0 0 6px #ff6467); animation: pulse 1.5s infinite;">🚨</div>',
                iconSize: [20, 20],
                className: 'event-alert-icon'
            })
        });
        
        const eventPopup = `
            <div class="flight-popup" style="border: 2px solid #ff6467;">
                <strong style="color: #ff6467;">⚠️ LENTO-EVENT!</strong><br>
                ${contract.aircraft}<br>
                ${contract.originIdent} → ${contract.destIdent}<br>
                <span style="font-size: 12px; color: #ff6467;">Tapahtuma aktiivillä lennolla</span>
            </div>
        `;
        eventMarker.bindPopup(eventPopup);
        eventMarker.addTo(mapInstance);
        mapMarkers.push(eventMarker);
        
        // Näytetään varoitus pelaajalle
        showNotification(`⚠️ Lento-event lennolla ${contract.aircraft}!`, 'warning');
        
        return true;
    }
    return false;
}

/**
 * Näyttää aktiivisten lentojen listan kartan alapuolella
 * @param {Array} activeContracts - Lista aktiivisista sopimuksista
 * @param {Number} currentDay - Nykyinen päivä pelissa
 */
function displayActiveFlyingList(activeContracts, currentDay) {
    const listContainer = document.getElementById('active-flights-list');
    
    if (!listContainer) {
        console.warn('Active flights list container ei löytynyt');
        return;
    }
    
    // Puhdista vanha lista
    listContainer.innerHTML = '';
    
    if (activeContracts.length === 0) {
        listContainer.innerHTML = '<div class="empty-state">Ei aktiivisia lentoja</div>';
        return;
    }
    
    // Luo kortti jokaiselle aktiiVelle lennolle
    activeContracts.forEach(contract => {
        const card = document.createElement('div');
        card.className = 'flight-card';
        
        // Määritellään väri edistymisen mukaan
        let statusColor = 'status-progress';
        if (contract.progressPercent > 70) {
            statusColor = 'status-critical';
        }
        
        card.innerHTML = `
            <div class="flight-card-header">
                <div class="flight-info">
                    <div class="aircraft-name">${contract.aircraft}</div>
                    <div class="flight-route">${contract.originIdent} → ${contract.destIdent}</div>
                </div>
                <div class="flight-status ${statusColor}">
                    ${contract.status === 'IN_PROGRESS' ? '✈️ LENTÄÄ' : '📋 HYVÄKSYTTY'}
                </div>
            </div>
            
            <div class="flight-progress">
                <div class="progress-label">
                    <span>Päivä ${contract.startDay}</span>
                    <span>Päivä ${currentDay}</span>
                    <span>Est. ${contract.estimatedDay}</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${contract.progressPercent}%"></div>
                </div>
                <div class="progress-percent">${contract.progressPercent}%</div>
            </div>
            
            <div class="flight-reward">
                <span>Palkinto:</span> <span class="reward-amount">€${formatMoney(contract.reward)}</span>
            </div>
        `;
        
        listContainer.appendChild(card);
    });
}

/**
 * Lataa kartan näkymän
 * Kutsutaan kun käyttäjä klikkaa "Kartta"-nappia
 */
async function loadMapView() {
    // Varmistetaan että kartan konttainer on näkyvissä
    const mapContainer = document.getElementById('map-container');
    if (!mapContainer) {
        console.error('Kartan konttaineria ei löytynyt');
        return;
    }
    
    // Alustetaan kartta
    await initializeMap();
    
    // Jos kartta on jo alustettu, päivitetään koko näkymä
    if (mapInstance) {
        // Pieni viive varmistaa että DOM on päivitetty
        setTimeout(() => {
            mapInstance.invalidateSize();
        }, 100);
    }
}

// Piirretään pääkotisatama (tukikohta) kartalle erityisellä ikonilla
function drawHeadquarters(airports, headquartersIdent) {
    // Haetaan pääkotisataman koordinaatit
    const headquarters = airports.find(a => a.ident === headquartersIdent);
    
    console.log("drawHeadquarters debug:", {
        headquartersIdent: headquartersIdent,
        airportsCount: airports.length,
        found: headquarters !== undefined,
        headquarters: headquarters
    });
    
    if (!headquarters || !headquarters.latitude_deg || !headquarters.longitude_deg) {
        console.warn("Pääkotisataman koordinaatteja ei löytynyt:", headquartersIdent);
        return;
    }
    
    // Luodaan erityinen merkki pääkotisatamalle (kultainen väri)
    const hqMarker = L.marker(
        [headquarters.latitude_deg, headquarters.longitude_deg],
        {
            icon: L.divIcon({
                className: "headquarters-icon",
                html: "🏢",
                iconSize: [40, 40],
                iconAnchor: [20, 20],
            }),
            title: "PÄÄKOTISATAMA"
        }
    );
    
    // Lisätään popup
    const popupContent = `
        <strong>🏢 PÄÄKOTISATAMA</strong><br>
        ${headquarters.name}<br>
        ${headquarters.ident}
    `;
    hqMarker.bindPopup(popupContent);
    
    // Lisätään kartalle
    hqMarker.addTo(mapInstance);
}

// Rekisteröidään näkymän lataaja
window.loadMapView = loadMapView;
