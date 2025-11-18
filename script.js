// --- 1. INICIALIZACIÓN DEL MAPA ---
var centroMerida = [20.9754, -89.6169];
var map = L.map('map', { zoomControl: false }).setView(centroMerida, 13);
L.control.zoom({ position: 'topleft' }).addTo(map);

// --- CAPAS BASE ---
var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OSM' }).addTo(map);
var cartoLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© CARTO' });
var cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© CARTO' });
var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © Esri' });

L.control.layers({ "Calles": osm, "Claro": cartoLight, "Oscuro": cartoDark, "Satélite": satellite }, null, { position: 'bottomleft' }).addTo(map);

// --- 2. VARIABLES GLOBALES ---
var espaciosData = null;
var manzanasData = null; // Aquí guardaremos las manzanas
var geojsonLayer;
var selectedLayer = null; 
var bufferLayer = null; 
var radiusLineLayer = null;
var allRadiiLayer = L.layerGroup(); // Capa para todos los radios (botón cobertura)
var isRadiiVisible = false;

// Elementos DOM Dashboard Individual
var infoDefault = document.getElementById('info-default');
var infoPanel = document.getElementById('info-panel');
var tituloEl = document.getElementById('dash-titulo');
var modulosEl = document.getElementById('dash-modulos');
var nomEl = document.getElementById('dash-nom');
var areaEl = document.getElementById('dash-area');

// Elementos Población (Individual)
var pobTotalEl = document.getElementById('dash-pob-total');
var pob014El = document.getElementById('dash-pob-0-14');
var pob65El = document.getElementById('dash-pob-65');
var pobDiscEl = document.getElementById('dash-pob-disc');

// Elementos Dashboard Global
var statTotalEp = document.getElementById('stat-total-ep');
var statTotalArea = document.getElementById('stat-total-area');
var statPobTotal = document.getElementById('stat-pob-total');
var statPobBeneficiada = document.getElementById('stat-pob-beneficiada');
var btnToggleRadii = document.getElementById('btn-toggle-radii');

// Modal Elements
var modalOverlay = document.getElementById('modal-overlay');
var modalCloseBtn = document.getElementById('modal-close-btn');


// --- 3. ESTILOS ---
function style(feature) {
    return { fillColor: '#238b45', weight: 1, opacity: 1, color: 'white', fillOpacity: 0.7 };
}
var highlightStyle = { weight: 5, color: '#FFFF00', dashArray: '', fillOpacity: 0.7 };
var bufferStyle = { fillColor: '#007bff', fillOpacity: 0.1, stroke: true, color: '#007bff', weight: 2, dashArray: '5, 5' };

// --- 4. ANÁLISIS ESPACIAL (TURF.JS) ---

// Calcular población total beneficiada (GLOBAL)
// Nota: Esto es una aproximación basada en la suma de manzanas intersectadas por cualquier radio
function calculateGlobalCoverage() {
    if (!espaciosData || !manzanasData) return;

    let totalPobBeneficiada = 0;
    let manzanasBeneficiadas = new Set(); // Usamos un Set para no contar manzanas dobles

    // Recorremos todos los espacios
    espaciosData.features.forEach(espacio => {
        var radio = parseFloat(espacio.properties.RAD_INF || 0);
        if (radio <= 0) return;

        var centroEspacio = turf.center(espacio); // Centro del parque

        // Filtramos manzanas que caen dentro de este radio
        manzanasData.features.forEach((manzana, index) => {
            var centroManzana = turf.center(manzana);
            var distancia = turf.distance(centroEspacio, centroManzana, {units: 'meters'});

            if (distancia <= radio) {
                manzanasBeneficiadas.add(index); // Guardamos el índice único
            }
        });
    });

    // Sumamos la población de las manzanas únicas encontradas
    manzanasBeneficiadas.forEach(index => {
        var props = manzanasData.features[index].properties;
        totalPobBeneficiada += (parseFloat(props.POB1) || 0);
    });

    statPobBeneficiada.innerText = totalPobBeneficiada.toLocaleString();
}

// Calcular población beneficiada (INDIVIDUAL - Al hacer clic)
function calculateIndividualStats(centerPoint, radiusMeters) {
    if (!manzanasData) return;

    let sumTotal = 0;
    let sum014 = 0;
    let sum65 = 0;
    let sumDisc = 0;

    // Convertir radio a kilómetros para Turf
    let radiusKm = radiusMeters / 1000;

    // Iterar sobre manzanas (Optimización: usar distancia de centroide a centroide)
    manzanasData.features.forEach(manzana => {
        var centroManzana = turf.center(manzana);
        var distancia = turf.distance(centerPoint, centroManzana, {units: 'kilometers'});

        if (distancia <= radiusKm) {
            var p = manzana.properties;
            sumTotal += (parseFloat(p.POB1) || 0);
            sum014 += (parseFloat(p.POB8) || 0);
            sum65 += (parseFloat(p.POB23) || 0);
            sumDisc += (parseFloat(p.DISC1) || 0);
        }
    });

    // Actualizar el Dashboard
    pobTotalEl.innerText = sumTotal.toLocaleString();
    pob014El.innerText = sum014.toLocaleString();
    pob65El.innerText = sum65.toLocaleString();
    pobDiscEl.innerText = sumDisc.toLocaleString();
}


// --- 5. FUNCIONES DE UI ---

function updatePanel(props) {
    tituloEl.innerHTML = props.CLAS_IMPLA || "Sin Clasificación";
    
    // Coordenadas Google Maps
    var center = selectedLayer.getBounds().getCenter();
    var gmapsLink = `https://www.google.com/maps?q=${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;
    modulosEl.innerHTML = `<b>Ubicación:</b> <a href="${gmapsLink}" target="_blank">Ver en Google Maps</a><br><b>Tipo:</b> ` + (props.MODULOS || "No definido");

    nomEl.innerHTML = "<b>Clasificación por escala de servicio (NOM-001-SEDATU-2021):</b> " + (props.ESC_SERV || "No definido");
    
    var area = props.SUP_TER_HA ? parseFloat(props.SUP_TER_HA).toFixed(2) : "0";
    areaEl.innerHTML = "<b>Área:</b> " + area + " ha";

    infoDefault.style.display = 'none';
    infoPanel.style.display = 'block';
}

function resetHighlight() {
    if (selectedLayer) {
        geojsonLayer.resetStyle(selectedLayer);
        selectedLayer = null;
    }
    if (bufferLayer) map.removeLayer(bufferLayer);
    if (radiusLineLayer) map.removeLayer(radiusLineLayer);
    
    // Resetear contadores individuales
    pobTotalEl.innerText = "0";
    pob014El.innerText = "0";
    pob65El.innerText = "0";
    pobDiscEl.innerText = "0";
}

function renderMap(featuresToRender) {
    resetHighlight();
    if (geojsonLayer) map.removeLayer(geojsonLayer);
    
    // Preparar capa de "Todos los Radios"
    allRadiiLayer.clearLayers();

    geojsonLayer = L.geoJSON(featuresToRender, {
        style: style,
        onEachFeature: function (feature, layer) {
            // Pre-crear círculos para la cobertura global
            var rad = parseFloat(feature.properties.RAD_INF || 0);
            if (rad > 0) {
                var circle = L.circle(layer.getBounds().getCenter(), {
                    radius: rad,
                    stroke: false,
                    fillColor: '#007bff',
                    fillOpacity: 0.15,
                    interactive: false // No bloquean clics
                });
                allRadiiLayer.addLayer(circle);
            }

            // Evento Clic Individual
            layer.on('click', function (e) {
                L.DomEvent.stopPropagation(e);
                resetHighlight();
                
                selectedLayer = e.target;
                selectedLayer.setStyle(highlightStyle);
                selectedLayer.bringToFront();
                
                updatePanel(feature.properties);

                var radius = parseFloat(feature.properties.RAD_INF || 0);
                if (radius > 0) {
                    var centerLatLng = layer.getBounds().getCenter();
                    
                    // 1. Dibujar Buffer Visual
                    bufferLayer = L.circle(centerLatLng, { ...bufferStyle, radius: radius }).addTo(map);
                    
                    // 2. Línea de Radio
                    var edgePoint = [centerLatLng.lat, bufferLayer.getBounds().getNorthEast().lng];
                    radiusLineLayer = L.polyline([centerLatLng, edgePoint], { className: 'leaflet-radius-line' }).addTo(map);
                    radiusLineLayer.bindTooltip(radius.toFixed(0) + " m", { permanent: true, direction: 'right', className: 'leaflet-radius-tooltip' }).openTooltip();

                    // 3. CALCULAR POBLACIÓN (Turf)
                    // Convertir LatLng de Leaflet a Punto GeoJSON para Turf [lng, lat]
                    var turfPoint = turf.point([centerLatLng.lng, centerLatLng.lat]);
                    calculateIndividualStats(turfPoint, radius);

                    map.fitBounds(bufferLayer.getBounds());
                } else {
                    map.fitBounds(selectedLayer.getBounds());
                }
            });
        }
    }).addTo(map);
}

// --- 6. CARGA DE DATOS (PROMESAS) ---

Promise.all([
    fetch('espacios_publicos.geojson').then(r => r.json()),
    fetch('manzanas.geojson').then(r => r.json())
]).then(([espacios, manzanas]) => {
    espaciosData = espacios;
    manzanasData = manzanas;

    // 1. Renderizar Mapa
    renderMap(espaciosData.features);

    // 2. Calcular Estadísticas Globales Iniciales
    var totalEspacios = espaciosData.features.length;
    var totalArea = espaciosData.features.reduce((sum, f) => sum + (parseFloat(f.properties.SUP_TER_HA) || 0), 0);
    var totalPobMuni = manzanasData.features.reduce((sum, f) => sum + (parseFloat(f.properties.POB1) || 0), 0);

    statTotalEp.innerText = totalEspacios;
    statTotalArea.innerText = totalArea.toFixed(2) + " ha";
    statPobTotal.innerText = totalPobMuni.toLocaleString();

    // 3. Calcular Cobertura Global (puede tardar un poco, por eso usamos setTimeout)
    setTimeout(() => {
        calculateGlobalCoverage();
    }, 500);

}).catch(err => console.error("Error cargando datos:", err));


// --- 7. EVENT LISTENERS ---

// Botón Cobertura Global
btnToggleRadii.addEventListener('click', function() {
    if (isRadiiVisible) {
        map.removeLayer(allRadiiLayer);
        btnToggleRadii.innerHTML = '<i class="fa-solid fa-circle-notch"></i> Ver Cobertura (Radios)';
    } else {
        map.addLayer(allRadiiLayer);
        btnToggleRadii.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Ocultar Cobertura';
    }
    isRadiiVisible = !isRadiiVisible;
});

// Botón Ubicación
document.getElementById('btn-ubicacion').addEventListener('click', function() {
    navigator.geolocation.getCurrentPosition(function(position) {
        var loc = [position.coords.latitude, position.coords.longitude];
        map.setView(loc, 16);
        L.marker(loc).addTo(map).bindPopup("<b>¡Estás aquí!</b>").openPopup();
    }, () => alert('No se pudo obtener ubicación'));
});

// Clic Mapa (Reset)
map.on('click', function() {
    resetHighlight();
    infoDefault.style.display = 'block';
    infoPanel.style.display = 'none';
});

// Modales y Pestañas (Lógica anterior)
document.querySelectorAll('#main-header .tab-link').forEach(btn => {
    btn.addEventListener('click', function() {
        var id = this.getAttribute('data-tab');
        modalOverlay.style.display = 'flex';
        document.querySelectorAll('.modal-tab-pane').forEach(p => p.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    });
});
modalCloseBtn.addEventListener('click', () => modalOverlay.style.display = 'none');
modalOverlay.addEventListener('click', (e) => { if(e.target === modalOverlay) modalOverlay.style.display = 'none'; });