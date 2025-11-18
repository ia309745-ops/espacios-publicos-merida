// --- 1. INICIALIZACIÓN DEL MAPA ---
var centroMerida = [20.9754, -89.6169];
var map = L.map('map', {
    zoomControl: false
}).setView(centroMerida, 13);

L.control.zoom({ position: 'topleft' }).addTo(map);

// --- DEFINICIÓN DE CAPAS BASE ---
var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
});
var cartoLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '© <a href=".../copyright">OSM</a> &copy; <a href=".../attributions">CARTO</a>'
});
var cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '© <a href=".../copyright">OSM</a> &copy; <a href=".../attributions">CARTO</a>'
});
var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
});
osm.addTo(map);
var baseMaps = {
    "Calles": osm,
    "Claro": cartoLight,
    "Oscuro": cartoDark,
    "Satélite": satellite
};
L.control.layers(baseMaps, null, { position: 'bottomleft' }).addTo(map);


// --- 2. VARIABLES GLOBALES ---
var allData;
var geojsonLayer;
var selectedLayer = null; 
var bufferLayer = null; 
var radiusLineLayer = null; // Para la línea de radio

// Elementos del dashboard (polígono)
var infoDefault = document.getElementById('info-default');
var infoPanel = document.getElementById('info-panel');
var tituloEl = document.getElementById('dash-titulo');
var modulosEl = document.getElementById('dash-modulos');
var nomEl = document.getElementById('dash-nom');
var areaEl = document.getElementById('dash-area');

// Elementos del Modal
var modalOverlay = document.getElementById('modal-overlay');
var modalContainer = document.getElementById('modal-container');
var modalCloseBtn = document.getElementById('modal-close-btn');


// --- 3. FUNCIÓN DE ESTILO ---
function style(feature) {
    return {
        fillColor: '#238b45', 
        weight: 1,
        opacity: 1,
        color: 'white',
        fillOpacity: 0.7
    };
}
var highlightStyle = {
    weight: 5,
    color: '#FFFF00', // Amarillo brillante
    dashArray: '',
    fillOpacity: 0.7
};

// --- 4. FUNCIÓN PARA ACTUALIZAR EL PANEL DE INFO (Polígono) ---
function updatePanel(props) {
    // Título con CLAS_IMPLA
    tituloEl.innerHTML = props.CLAS_IMPLA || "Sin Clasificación";
    
    // --- ¡CAMBIO SOLICITADO! ---
    // Reemplaza "Tipo" con enlace a Google Maps
    var center = selectedLayer.getBounds().getCenter(); // 'selectedLayer' es la capa (polígono) clickeada
    var lat = center.lat.toFixed(6);
    var lng = center.lng.toFixed(6);
    // Genera el enlace de Google Maps con las coordenadas del centroide
    var gmapsLink = `https://www.google.com/maps?q=${lat},${lng}`;
    
    modulosEl.innerHTML = `<b>Ubicación:</b> <a href="${gmapsLink}" target="_blank">Ver en Google Maps</a>`;
    // --- FIN DEL CAMBIO ---
    
    // Texto de la NOM
    nomEl.innerHTML = "<b>Clasificación por escala de servicio (NOM-001-SEDATU-2021):</b> " + (props.ESC_SERV || "No definido");
    
    // Área
    var area = props.SUP_TER_HA ? parseFloat(props.SUP_TER_HA).toFixed(2) : "No definida";
    areaEl.innerHTML = "<b>Área:</b> " + area + " ha";

    infoDefault.style.display = 'none';
    infoPanel.style.display = 'block';
}

// Función para resetear el resaltado
function resetHighlight() {
    if (selectedLayer) {
        geojsonLayer.resetStyle(selectedLayer); 
        selectedLayer = null;
    }
    if (bufferLayer) {
        map.removeLayer(bufferLayer);
        bufferLayer = null;
    }
    if (radiusLineLayer) {
        map.removeLayer(radiusLineLayer);
        radiusLineLayer = null;
    }
}

// --- 5. FUNCIÓN PRINCIPAL PARA RENDERIZAR EL MAPA ---
function renderMap(featuresToRender) {
    resetHighlight(); 
    if (geojsonLayer) {
        map.removeLayer(geojsonLayer);
    }
    
    infoDefault.style.display = 'block';
    infoPanel.style.display = 'none';

    geojsonLayer = L.geoJSON(featuresToRender, {
        style: style,
        onEachFeature: function (feature, layer) {
            
            layer.on('click', function (e) {
                L.DomEvent.stopPropagation(e); 
                
                resetHighlight(); 
                
                selectedLayer = e.target; 
                selectedLayer.setStyle(highlightStyle); 
                selectedLayer.bringToFront(); 

                // 'updatePanel' ahora usará 'selectedLayer' para obtener el centroide
                updatePanel(feature.properties);

                var radius = feature.properties.RAD_INF;
                
                if (radius && radius > 0) {
                    var center = layer.getBounds().getCenter();
                    bufferLayer = L.circle(center, {
                        radius: parseFloat(radius), 
                        className: 'leaflet-buffer-layer'
                    }).addTo(map);
                    
                    selectedLayer.bringToFront();
                    
                    var radiusMeters = parseFloat(radius);
                    var edgePoint = [center.lat, bufferLayer.getBounds().getNorthEast().lng];

                    radiusLineLayer = L.polyline([center, edgePoint], {
                        className: 'leaflet-radius-line'
                    }).addTo(map);

                    radiusLineLayer.bindTooltip(radiusMeters.toFixed(0) + " m", {
                        permanent: true,
                        direction: 'right',
                        className: 'leaflet-radius-tooltip',
                        offset: [10, 0] 
                    }).openTooltip();

                    map.fitBounds(bufferLayer.getBounds());
                } else {
                    map.fitBounds(selectedLayer.getBounds());
                }
            });
        }
    }).addTo(map);
}

// --- 6. CARGA DE DATOS GEOJSON (Fetch) ---
fetch('espacios_publicos.geojson')
    .then(function (response) { return response.json(); })
    .then(function (data) {
        allData = data;
        renderMap(allData.features); 
    });

// --- 7. EVENT LISTENERS (INTERACTIVIDAD) ---

// LÓGICA DEL MODAL GLOBAL
document.querySelectorAll('#main-header .tab-link').forEach(function(button) {
    button.addEventListener('click', function() {
        var tabId = this.getAttribute('data-tab');
        modalOverlay.style.display = 'flex';
        document.querySelectorAll('.modal-tab-pane').forEach(function(pane) {
            pane.classList.remove('active');
        });
        document.querySelectorAll('#main-header .tab-link').forEach(function(btn) {
            btn.classList.remove('active');
        });
        document.getElementById(tabId).classList.add('active');
        this.classList.add('active');
    });
});
function closeModal() {
    modalOverlay.style.display = 'none';
    document.querySelectorAll('#main-header .tab-link').forEach(function(btn) {
        btn.classList.remove('active');
    });
}
modalCloseBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', function(e) {
    if (e.target === modalOverlay) {
        closeModal();
    }
});


// B. BOTÓN DE UBICACIÓN
document.getElementById('btn-ubicacion').addEventListener('click', function() {
    navigator.geolocation.getCurrentPosition(function(position) {
        var userLocation = [position.coords.latitude, position.coords.longitude];
        map.setView(userLocation, 16);
        L.marker(userLocation).addTo(map).bindPopup("<b>¡Estás aquí!</b>").openPopup();
    }, function() {
        alert('No se pudo obtener tu ubicación.');
    });
});

// C. CLIC EN EL MAPA (para des-seleccionar)
map.on('click', function() {
    resetHighlight();
    infoDefault.style.display = 'block';
    infoPanel.style.display = 'none';
});

// D. LÓGICA DE ESTRELLAS DE CALIFICACIÓN (Apunta al modal)
var stars = document.querySelectorAll('#modal-tab-calificar .rating-stars .fa-star');
stars.forEach(function(star) {
    star.addEventListener('click', function(e) {
        L.DomEvent.stopPropagation(e); 
        var rating = this.getAttribute('data-value');
        stars.forEach(function(s) { s.classList.remove('selected'); });
        for (var i = 0; i < rating; i++) {
            stars[i].classList.add('selected');
        }
    });
});

// E. BOTÓN DE ENVIAR CALIFICACIÓN (Apunta al modal)
document.getElementById('submit-rating-btn').addEventListener('click', function(e) {
    L.DomEvent.stopPropagation(e); 
    alert('¡Gracias por calificar el visor!\n\n(Esta función es una demostración.)');
});