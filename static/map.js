/**
 * map.js - Maailmankartan näkymä (Developer 4 / Kehittäjä 4)
 * 
 * Näyttää karttanäkymän, jossa visualisoidaan:
 * - Lennolla olevat koneet ja niiden reitit (interpoloituna päivän edetessä)
 * - Maassa olevat koneet (idlenä tai huollossa)
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
 * - GET /api/map-data → aktiivisten koneiden ja reittien haku
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
        
        if (!mapData) {
            console.warn('Karttadataa ei saatu');
            return;
        }
        
        // Tallennetaan data välimuistiin
        mapDataCache = mapData;
        
        // Piirretään koneet (lennot ja idle)
        if (mapData.aircrafts && mapData.aircrafts.length > 0) {
            drawAircrafts(mapData.aircrafts);
        } else {
            const listContainer = document.getElementById('active-flights-list');
            if (listContainer) {
                listContainer.innerHTML = '<div class="empty-state">Ei koneita</div>';
            }
        }
        
        // Piirretään tukikohdat (jos niitä on)
        if (mapData.ownedBases && mapData.ownedBases.length > 0) {
            drawBases(mapData.ownedBases);
        }
        
        // Päivitään alempi lista aktiivisista lennoista (vain ne jotka lentää)
        const activeFlights = (mapData.aircrafts || []).filter(a => a.isFlying);
        displayActiveFlyingList(activeFlights, mapData.currentDay);
        
        // Päivitetään headerin laskuri
        const flightCountEl = document.getElementById('flights-count');
        if(flightCountEl) {
            flightCountEl.textContent = `${activeFlights.length} LENTÄÄ`;
        }
        
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
 * Piirtää kaikki koneet kartalle.
 * - Jos lentää: piirtää reitin, lähtö/määräpään ja koneen interpoloidun sijainnin
 * - Jos maassa: piirtää koneen nykyiselle kentälle
 */
function drawAircrafts(aircrafts) {
    if (!aircrafts || aircrafts.length === 0) return;
    
    // Seurataan mitä lentokenttiä olemme jo piirtäneet (välttää duplikaatit)
    const drawnOrigins = new Set();
    const drawnDestinations = new Set();
    
    aircrafts.forEach((aircraft) => {
        
        if (aircraft.isFlying) {
            // --- KONE ON LENNOLLA ---
            const from = [aircraft.originLat, aircraft.originLon];
            const to = [aircraft.destLat, aircraft.destLon];
            
            // 1. Piirretään lähtöpiste
            if (!drawnOrigins.has(aircraft.originIdent)) {
                const originMarker = L.circleMarker(from, {
                    radius: 6,
                    fillColor: '#888888',
                    fillOpacity: 0.8,
                    stroke: true,
                    weight: 1,
                    color: '#666666'
                }).bindPopup(`<b>${aircraft.originIdent}</b><br>${aircraft.originName}`);
                originMarker.addTo(mapInstance);
                mapMarkers.push(originMarker);
                drawnOrigins.add(aircraft.originIdent);
            }
            
            // 2. Piirretään määräpiste
            if (!drawnDestinations.has(aircraft.destIdent)) {
                const destMarker = L.circleMarker(to, {
                    radius: 7,
                    fillColor: '#00d4ff',
                    fillOpacity: 0.9,
                    stroke: true,
                    weight: 2,
                    color: '#00a8cc'
                }).bindPopup(`<b>${aircraft.destIdent}</b><br>${aircraft.destName}`);
                destMarker.addTo(mapInstance);
                mapMarkers.push(destMarker);
                drawnDestinations.add(aircraft.destIdent);
            }
            
            // 3. Piirretään lentoreitti
            const polyline = L.polyline([from, to], {
                color: '#00d4ff',
                weight: 2,
                opacity: 0.6,
                dashArray: '5, 5'
            });
            polyline.addTo(mapInstance);
            mapPolylines.push(polyline);
            
            // 4. Lasketaan koneen sijainti viivalla (progress 0..100)
            const pct = Math.min(Math.max(aircraft.progressPercent, 0), 100) / 100.0;
            const currentLat = from[0] + (to[0] - from[0]) * pct;
            const currentLon = from[1] + (to[1] - from[1]) * pct;
            
            // 5. Piirretään koneen ikoni oikeaan kohtaan
            const iconHtml = getAircraftIconHtml(aircraft.status, true); 
            const planeMarker = L.marker([currentLat, currentLon], {
                icon: L.divIcon({
                    html: iconHtml,
                    className: 'aircraft-marker-icon', // tyhjä luokka, tyylit iconHtml:ssa
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                }),
                zIndexOffset: 1000
            });
            
            const popupContent = `
                <div class="flight-popup">
                    <strong>${aircraft.registration}</strong> (${aircraft.status})<br>
                    Reitti: ${aircraft.originIdent} → ${aircraft.destIdent}<br>
                    Edistyminen: ${aircraft.progressPercent}%
                </div>
            `;
            planeMarker.bindPopup(popupContent);
            planeMarker.addTo(mapInstance);
            mapMarkers.push(planeMarker);
            
        } else {
            // --- KONE ON MAASSA (IDLE/HUOLTO) ---
            if (!aircraft.locationLat || !aircraft.locationLon) return;
            
            const pos = [aircraft.locationLat, aircraft.locationLon];
            
            // Piirretään koneen ikoni kentälle
            const iconHtml = getAircraftIconHtml(aircraft.status, false);
            
            // Jos samalla kentällä on monta konetta, voisi harkita klusterointia,
            // mutta tässä yksinkertainen toteutus (pieni satunnainen heitto jotta eivät ole täysin päällekkäin)
            const jitterLat = (Math.random() - 0.5) * 0.05;
            const jitterLon = (Math.random() - 0.5) * 0.05;
            
            const planeMarker = L.marker([pos[0] + jitterLat, pos[1] + jitterLon], {
                icon: L.divIcon({
                    html: iconHtml,
                    className: 'aircraft-marker-icon',
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                })
            });
            
            const popupContent = `
                <div class="flight-popup">
                    <strong>${aircraft.registration}</strong><br>
                    Status: ${aircraft.status}<br>
                    Sijainti: ${aircraft.locationIdent}
                </div>
            `;
            planeMarker.bindPopup(popupContent);
            planeMarker.addTo(mapInstance);
            mapMarkers.push(planeMarker);
        }
    });
}

/**
 * Palauttaa oikean värisen/tyylisen ikonin statuksen perusteella
 * @param {string} status - Koneen status (IDLE, BUSY, MAINTENANCE, jne.)
 * @param {boolean} isFlying - Onko kone ilmassa
 */
function getAircraftIconHtml(status, isFlying) {
    let color = '#ffffff'; // oletus
    let shadowColor = 'rgba(255,255,255,0.5)';
    let icon = '✈️';
    
    // Normalisoidaan status
    const s = (status || '').toUpperCase();
    
    if (s.includes('BUSY') || s === 'ENROUTE' || isFlying) {
        // Lennolla -> Syaani
        color = '#00d4ff';
        shadowColor = 'rgba(0, 212, 255, 0.8)';
    } else if (s === 'IDLE') {
        // Vapaa -> Vihreä
        color = '#05df72';
        shadowColor = 'rgba(5, 223, 114, 0.6)';
    } else if (s === 'MAINTENANCE' || s === 'BROKEN') {
        // Huolto/Rikki -> Punainen/Oranssi
        color = '#ff6467';
        shadowColor = 'rgba(255, 100, 103, 0.8)';
        icon = '🛠️';
    } else if (s.includes('RTB')) {
        // Return To Base -> Keltainen/Oranssi
        color = '#f0b100';
        shadowColor = 'rgba(240, 177, 0, 0.8)';
    }
    
    // Luodaan SVG- tai div-pohjainen ikoni, jossa on hehku
    // Käytetään drop-shadow filtteriä hehkun luomiseen
    return `
        <div style="
            font-size: ${isFlying ? '24px' : '18px'};
            color: ${color};
            filter: drop-shadow(0 0 6px ${shadowColor});
            transition: all 0.3s ease;
            transform: ${isFlying ? 'rotate(-45deg)' : 'rotate(0deg)'};
        ">
            ${icon}
        </div>
    `;
}

/**
 * Näyttää aktiivisten lentojen listan kartan alapuolella
 * @param {Array} activeFlights - Lista lentävistä koneista
 * @param {Number} currentDay - Nykyinen päivä pelissa
 */
function displayActiveFlyingList(activeFlights, currentDay) {
    const listContainer = document.getElementById('active-flights-list');
    
    if (!listContainer) return;
    
    listContainer.innerHTML = '';
    
    if (!activeFlights || activeFlights.length === 0) {
        listContainer.innerHTML = '<div class="empty-state">Ei aktiivisia lentoja</div>';
        return;
    }
    
    activeFlights.forEach(aircraft => {
        const card = document.createElement('div');
        card.className = 'flight-card';
        
        let statusColor = 'status-progress';
        if (aircraft.progressPercent > 80) statusColor = 'status-success';
        
        const isRTB = (aircraft.status || '').includes('RTB');
        const statusText = isRTB ? '🏠 PALUU' : '✈️ LENTÄÄ';
        
        card.innerHTML = `
            <div class="flight-card-header">
                <div class="flight-info">
                    <div class="aircraft-name">${aircraft.registration}</div>
                    <div class="flight-route">${aircraft.originIdent} → ${aircraft.destIdent}</div>
                </div>
                <div class="flight-status ${statusColor}">
                    ${statusText}
                </div>
            </div>
            
            <div class="flight-progress">
                <div class="progress-label">
                    <span>Lähtö: pv ${aircraft.startDay}</span>
                    <span>Nyt: pv ${currentDay}</span>
                    <span>ETA: pv ${aircraft.arrivalDay}</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${aircraft.progressPercent}%"></div>
                </div>
                <div class="progress-percent">${aircraft.progressPercent}%</div>
            </div>
            
            ${!isRTB ? `<div class="flight-reward"><span>Palkkio:</span> <span class="reward-amount">€${formatMoney(aircraft.reward)}</span></div>` : ''}
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
    
    // Odotetaan hetki, että näkymä on varmasti renderöitynyt ja näkyvissä (display: block)
    // Tämä on kriittistä Leafletin koon laskennalle
    requestAnimationFrame(async () => {
        // Alustetaan kartta
        await initializeMap();
        
        // Jos kartta on jo alustettu, pakotetaan koon päivitys
        if (mapInstance) {
            mapInstance.invalidateSize();
        }
    });
}

// Piirretään kaikki omistetut tukikohdat kartalle
function drawBases(ownedBases) {
    ownedBases.forEach(base => {
        if (!base.latitude || !base.longitude) {
            return;
        }
        
        const isHQ = base.isHeadquarters;
        const iconHtml = isHQ ? '🏢' : '🏠';
        const iconSize = isHQ ? 40 : 30;
        const zIndex = isHQ ? 500 : 400; // Alle koneiden (1000)
        
        // Luodaan merkki tukikohdalle
        const baseMarker = L.marker(
            [base.latitude, base.longitude],
            {
                icon: L.divIcon({
                    className: "headquarters-icon", // Käytetään samaa tyyliä (hohde)
                    html: `<div style="font-size:${iconSize}px; filter: drop-shadow(0 0 8px #f0b100);">${iconHtml}</div>`,
                    iconSize: [iconSize, iconSize],
                    iconAnchor: [iconSize / 2, iconSize / 2],
                }),
                title: base.name,
                zIndexOffset: zIndex
            }
        );
        
        // Lisätään popup
        const popupContent = `
            <strong>${isHQ ? 'PÄÄKOTISATAMA' : 'TUKIKOHTA'}</strong><br>
            ${base.name}<br>
            <span style="font-family: monospace;">${base.ident}</span>
        `;
        baseMarker.bindPopup(popupContent);
        
        // Lisätään kartalle ja listaan
        baseMarker.addTo(mapInstance);
        mapMarkers.push(baseMarker);
    });
}

// Rekisteröidään näkymän lataaja
window.loadMapView = loadMapView;