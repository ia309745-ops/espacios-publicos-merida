// --- 1. INICIALIZACIÓN DEL MAPA ---
var centroMerida = [20.9754, -89.6169];
// Zoom Control activado por defecto (lo movemos con CSS)
var map = L.map('map', { zoomControl: true }).setView(centroMerida, 13);

// --- CAPAS BASE ---
var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OSM' });
var cartoLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© CARTO' });
var cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© CARTO' });
var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © Esri' });

osm.addTo(map); // Capa por defecto

L.control.layers({ "Calles": osm, "Claro": cartoLight, "Oscuro": cartoDark, "Satélite": satellite }, null, { position: 'bottomleft' }).addTo(map);

// --- 2. VARIABLES GLOBALES ---
var espaciosData = null;
var manzanasData = null; 
var geojsonLayer; // Capa de Espacios Públicos
var manzanaHighlightLayer = L.layerGroup().addTo(map); // Capa para manzanas resaltadas (tenues)
var selectedLayer = null; 
var bufferLayer = null; 
var radiusLineLayer = null;
var allRadiiLayer = L.layerGroup();
var isRadiiVisible = false;

// Elementos DOM
var infoDefault = document.getElementById('info-default');
var infoPanel = document.getElementById('info-panel');
var tituloEl = document.getElementById('dash-titulo');
var modulosEl = document.getElementById('dash-modulos');
var nomEl = document.getElementById('dash-nom');
var areaEl = document.getElementById('dash-area');

var pobTotalEl = document.getElementById('dash-pob-total');
var pob014El = document.getElementById('dash-pob-0-14');
var pob65El = document.getElementById('dash-pob-65');
var pobDiscEl = document.getElementById('dash-pob-disc');

var statTotalEp = document.getElementById('stat-total-ep');
var statTotalArea = document.getElementById('stat-total-area');
var statPobTotal = document.getElementById('stat-pob-total');
var statPobBeneficiada = document.getElementById('stat-pob-beneficiada');
var btnToggleRadii = document.getElementById('btn-toggle-radii');

var modalOverlay = document.getElementById('modal-overlay');
var modalCloseBtn = document.getElementById('modal-close-btn');


// --- 3. ESTILOS ---

// Estilo Verde Sólido para Espacios Públicos
function style(feature) {
    return { 
        fillColor: '#238b45', 
        weight: 1, 
        opacity: 1, 
        color: 'white', 
        fillOpacity: 0.9 
    };
}

var highlightStyle = { 
    weight: 5, 
    color: '#FFFF00', 
    dashArray: '', 
    fillOpacity: 0.9 
};

var bufferStyle = { 
    fillColor: '#007bff', 
    fillOpacity: 0.1, 
    stroke: true, 
    color: '#007bff', 
    weight: 2, 
    dashArray: '5, 5' 
};

// --- 4. FUNCIONES AUXILIARES (PANEL Y RESET) ---

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
    manzanaHighlightLayer.clearLayers(); // Borra las manzanas iluminadas
    
    // Resetear contadores
    pobTotalEl.innerText = "0";
    pob014El.innerText = "0";
    pob65El.innerText = "0";
    pobDiscEl.innerText = "0";
}

// --- 5. ANÁLISIS ESPACIAL (TURF.JS) ---

// Cálculo Global
function calculateGlobalCoverage() {
    if (!espaciosData || !manzanasData) return;
    let totalPobBeneficiada = 0;
    let manzanasBeneficiadas = new Set();

    espaciosData.features.forEach(espacio => {
        var radio = parseFloat(espacio.properties.RAD_INF || 0);
        if (radio <= 0) return;
        var centroEspacio = turf.center(espacio);

        manzanasData.features.forEach((manzana, index) => {
            var centroManzana = turf.center(manzana);
            var distancia = turf.distance(centroEspacio, centroManzana, {units: 'meters'});
            if (distancia <= radio) {
                manzanasBeneficiadas.add(index);
            }
        });
    });

    manzanasBeneficiadas.forEach(index => {
        var props = manzanasData.features[index].properties;
        totalPobBeneficiada += (parseFloat(props.POB1) || 0);
    });

    statPobBeneficiada.innerText = totalPobBeneficiada.toLocaleString();
}

// Resalta y suma la población (Análisis Individual)
function highlightManzanas(centerPoint, radiusMeters) {
    manzanaHighlightLayer.clearLayers();
    if (!manzanasData) return;

    let radiusKm = radiusMeters / 1000;
    let sumTotal = 0; let sum014 = 0; let sum65 = 0; let sumDisc = 0;

    manzanasData.features.forEach(manzana => {
        var centroManzana = turf.center(manzana);
        var distancia = turf.distance(centerPoint, centroManzana, {units: 'kilometers'});

        if (distancia <= radiusKm) {
            var props = manzana.properties;
            sumTotal += (parseFloat(props.POB1) || 0);
            sum014 += (parseFloat(props.POB8) || 0);
            sum65 += (parseFloat(props.POB23) || 0);
            sumDisc += (parseFloat(props.DISC1) || 0);
            
            // Dibuja el contorno tenue de la manzana
            L.geoJSON(manzana, {
                style: {
                    fillColor: '#008080', 
                    fillOpacity: 0.05, // Muy tenue
                    color: '#4CAF50', // Borde verde
                    weight: 1, 
                    dashArray: '2, 4', 
                    opacity: 0.8,
                    interactive: false
                }
            }).addTo(manzanaHighlightLayer);
        }
    });

    pobTotalEl.innerText = sumTotal.toLocaleString();
    pob014El.innerText = sum014.toLocaleString();
    pob65El.innerText = sum65.toLocaleString();
    pobDiscEl.innerText = sumDisc.toLocaleString();
}

// --- 6. FUNCIÓN DE RENDERIZADO DEL MAPA ---
function renderMap(featuresToRender) {
    resetHighlight();
    if (geojsonLayer) map.removeLayer(geojsonLayer);
    
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
                    interactive: false
                });
                allRadiiLayer.addLayer(circle);
            }

            // Evento Clic
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
                    
                    // Buffer Visual
                    bufferLayer = L.circle(centerLatLng, { ...bufferStyle, radius: radius }).addTo(map);
                    
                    // Línea de Radio
                    var edgePoint = [centerLatLng.lat, bufferLayer.getBounds().getNorthEast().lng];
                    radiusLineLayer = L.polyline([centerLatLng, edgePoint], { className: 'leaflet-radius-line' }).addTo(map);
                    radiusLineLayer.bindTooltip(radius.toFixed(0) + " m", { permanent: true, direction: 'right', className: 'leaflet-radius-tooltip' }).openTooltip();

                    // Análisis Turf
                    var turfPoint = turf.point([centerLatLng.lng, centerLatLng.lat]);
                    highlightManzanas(turfPoint, radius);

                    map.fitBounds(bufferLayer.getBounds());
                } else {
                    map.fitBounds(selectedLayer.getBounds());
                }
            });
        }
    }).addTo(map);
}


// --- 7. CARGA DE DATOS BLINDADA ---
async function cargarDatos() {
    try {
        const responseEspacios = await fetch('espacios_publicos.geojson');
        if (!responseEspacios.ok) throw new Error("Falta 'espacios_publicos.geojson'");
        const espacios = await responseEspacios.json();

        const responseManzanas = await fetch('manzanas.geojson');
        if (!responseManzanas.ok) throw new Error("Falta 'manzanas.geojson'");
        const manzanas = await responseManzanas.json();

        espaciosData = espacios;
        manzanasData = manzanas;

        // Renderizar Mapa
        renderMap(espaciosData.features);
        
        // Estadísticas Globales
        var totalEspacios = espaciosData.features.length;
        var totalArea = espaciosData.features.reduce((sum, f) => sum + (parseFloat(f.properties.SUP_TER_HA) || 0), 0);
        var totalPobMuni = manzanasData.features.reduce((sum, f) => sum + (parseFloat(f.properties.POB1) || 0), 0);

        document.getElementById('stat-total-ep').innerText = totalEspacios;
        document.getElementById('stat-total-area').innerText = totalArea.toFixed(2) + " ha";
        document.getElementById('stat-pob-total').innerText = totalPobMuni.toLocaleString();
        
        setTimeout(() => { calculateGlobalCoverage(); }, 500);

    } catch (error) {
        console.error(error);
        alert("¡Error cargando datos!\n\n" + error.message);
    }
}

cargarDatos(); // Ejecutar carga


// --- 8. CONTROLES DE UI ---

// Botón Ubicación (Solo listener, el CSS lo posiciona)
document.getElementById('btn-ubicacion').addEventListener('click', function() {
    navigator.geolocation.getCurrentPosition(function(position) {
        var loc = [position.coords.latitude, position.coords.longitude];
        map.setView(loc, 16);
        L.marker(loc).addTo(map).bindPopup("<b>¡Estás aquí!</b>").openPopup();
    }, () => alert('No se pudo obtener ubicación'));
});

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

// Clic Mapa (Reset)
map.on('click', function() {
    resetHighlight();
    infoDefault.style.display = 'block';
    infoPanel.style.display = 'none';
});

// Modales y Pestañas
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

// Estrellas y Enviar Opinión
var stars = document.querySelectorAll('#modal-tab-calificar .rating-stars .fa-star');
stars.forEach(function(star) {
    star.addEventListener('click', function(e) {
        var rating = this.getAttribute('data-value');
        stars.forEach(function(s) { s.classList.remove('selected'); });
        for (var i = 0; i < rating; i++) { stars[i].classList.add('selected'); }
    });
});
document.getElementById('submit-rating-btn').addEventListener('click', function() {
    alert('¡Gracias por calificar el visor!\n\n(Esta función es una demostración.)');
});