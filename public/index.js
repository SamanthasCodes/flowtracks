// using var to work around a WebKit bug
var canvas = document.getElementById('canvas'); // eslint-disable-line

const pxRatio = Math.max(Math.floor(window.devicePixelRatio) || 1, 2);
canvas.width = canvas.clientWidth;
canvas.height = canvas.clientHeight;

const gl = canvas.getContext('webgl', {antialiasing: false});

// ================================================================
// TRACER PARTICLES
// ================================================================

const tracerCanvas = document.getElementById('tracers');
let tracerCtx = tracerCanvas.getContext('2d');

var windPixels = null;
var windMeta = null;

var tracerClouds = [];
var params = { cloudLifetimeDays: 30, particleCount: 50, showTrajectories: false };
const LEAD_CIRCLE_R = 2;
var HEAT_W = 360;
var HEAT_H = 180;
var heatBins = new Float32Array(HEAT_W * HEAT_H);
var heatCanvas = document.createElement('canvas');
heatCanvas.width = HEAT_W;
heatCanvas.height = HEAT_H;
var heatCtx = heatCanvas.getContext('2d');

var chartClouds = [];

var chartCanvas = document.createElement('canvas');
chartCanvas.width = 248;
chartCanvas.height = 120;
chartCanvas.style.cssText = 'display:block;';
var chartCtx = chartCanvas.getContext('2d');

function drawChart() {
    var cw = chartCanvas.width, ch = chartCanvas.height;
    chartCtx.clearRect(0, 0, cw, ch);

    if (chartClouds.length === 0) {
        chartCtx.fillStyle = 'rgba(240,237,232,0.4)';
        chartCtx.font = '12px "Cormorant SC", serif';
        chartCtx.textAlign = 'center';
        chartCtx.fillText('Click the ocean to release particles', cw / 2, ch / 2);
        chartCtx.textAlign = 'left';
        return;
    }

    var maxAge = 1, maxSpread = 0.01;
    for (var c = 0; c < chartClouds.length; c++) {
        var hist = chartClouds[c].spreadHistory;
        for (var i = 0; i < hist.length; i++) {
            if (i > maxAge) maxAge = i;
            if (hist[i] > maxSpread) maxSpread = hist[i];
        }
    }
    maxAge = Math.max(maxAge, 10);
    maxSpread = Math.max(maxSpread, 0.01);

    var padL = 32, padR = 8, padT = 14, padB = 22;
    var plotW = cw - padL - padR;
    var plotH = ch - padT - padB;

    // Gridlines
    chartCtx.strokeStyle = 'rgba(74,216,192,0.12)';
    chartCtx.lineWidth = 0.5;
    for (var i = 0; i <= 3; i++) {
        var y = padT + plotH * i / 3;
        chartCtx.beginPath();
        chartCtx.moveTo(padL, y);
        chartCtx.lineTo(padL + plotW, y);
        chartCtx.stroke();
    }

    // Y-axis tick labels \u2014 km (spread \u00d7 20000)
    chartCtx.fillStyle = 'rgba(240,237,232,0.5)';
    chartCtx.font = '10px "Cormorant", serif';
    chartCtx.textAlign = 'right';
    chartCtx.fillText((maxSpread * 20000).toFixed(0), padL - 3, padT + 8);
    chartCtx.fillText('0', padL - 3, padT + plotH + 3);

    // Rotated y-axis label
    chartCtx.save();
    chartCtx.fillStyle = 'rgba(240,237,232,0.4)';
    chartCtx.font = '9px "Cormorant SC", serif';
    chartCtx.textAlign = 'center';
    chartCtx.translate(9, padT + plotH / 2);
    chartCtx.rotate(-Math.PI / 2);
    chartCtx.fillText('Spread (km)', 0, 0);
    chartCtx.restore();

    // X-axis tick labels \u2014 days (frames \u00d7 SECONDS_PER_FRAME / 86400)
    chartCtx.fillStyle = 'rgba(240,237,232,0.5)';
    chartCtx.font = '10px "Cormorant", serif';
    chartCtx.textAlign = 'center';
    chartCtx.fillText('0', padL, padT + plotH + 12);
    chartCtx.fillText(
        (maxAge * SimCore.SECONDS_PER_FRAME / 86400).toFixed(0),
        padL + plotW, padT + plotH + 12
    );

    // X-axis label
    chartCtx.fillStyle = 'rgba(240,237,232,0.4)';
    chartCtx.font = '9px "Cormorant SC", serif';
    chartCtx.textAlign = 'center';
    chartCtx.fillText('Time (days)', padL + plotW / 2, ch - 2);

    // Curves \u2014 prefer cloud's own color (rotating palette), fall back to greens
    var fallback = ['#c8f03c', '#4dd8c0', '#2ab8a0', '#f0c83c', '#a8e040', '#7dd8c0'];
    for (var c = 0; c < chartClouds.length; c++) {
        var hist = chartClouds[c].spreadHistory;
        if (hist.length < 2) continue;
        chartCtx.strokeStyle = chartClouds[c].color || fallback[c % fallback.length];
        chartCtx.lineWidth = 1.5;
        chartCtx.beginPath();
        for (var i = 0; i < hist.length; i++) {
            var px = padL + (i / maxAge) * plotW;
            var py = padT + plotH - (hist[i] / maxSpread) * plotH;
            if (i === 0) chartCtx.moveTo(px, py);
            else chartCtx.lineTo(px, py);
        }
        chartCtx.stroke();
    }
}
var borderData = null;
var shadedReliefPixels = null;

// Load shaded relief for mountain ranges
var srImg = new Image();
srImg.src = 'shaded_relief_1440x719.png';
srImg.onload = function () {
    var srCanvas = document.createElement('canvas');
    srCanvas.width = srImg.width;
    srCanvas.height = srImg.height;
    var srCtx = srCanvas.getContext('2d');
    srCtx.drawImage(srImg, 0, 0);
    shadedReliefPixels = srCtx.getImageData(0, 0, srImg.width, srImg.height);
};

const wind = window.wind = new WindGL(gl);
wind.numParticles = 65000;
wind.diffusion = 0.001;

// ================================================================
// HEATMAP
// ================================================================

function drawHeatmap() {
    var maxVal = 0;
    for (var i = 0; i < heatBins.length; i++) {
        if (heatBins[i] > maxVal) maxVal = heatBins[i];
    }
    if (maxVal === 0) return;

    var MIN_HITS = 3;
    var imgData = heatCtx.createImageData(HEAT_W, HEAT_H);
    var logMax = Math.log(1 + maxVal);
    for (var i = 0; i < heatBins.length; i++) {
        var p = i * 4;
        if (heatBins[i] < MIN_HITS) {
            imgData.data[p]     = 0;
            imgData.data[p + 1] = 0;
            imgData.data[p + 2] = 0;
            imgData.data[p + 3] = 0;
        } else {
            var v = Math.log(1 + heatBins[i]) / logMax;
            var col = SimCore.heatmapColor(v);
            imgData.data[p]     = col[0];
            imgData.data[p + 1] = col[1];
            imgData.data[p + 2] = col[2];
            imgData.data[p + 3] = 160;
        }
    }
    heatCtx.putImageData(imgData, 0, 0);

    var w = tracerCanvas.width;
    var h = tracerCanvas.height;
    tracerCtx.drawImage(heatCanvas, 0, 0, w, h);
}

// ================================================================
// SPREAD CHART
// ================================================================

// Chart removed

// drawChart removed

// ================================================================
// LAND FILL + COUNTRY BORDERS
// ================================================================

function drawLandAndBorders() {
    if (!windPixels || !windMeta) return;

    var landCanvas = document.getElementById('land');
    if (!landCanvas) return;

    var ratio = meta['retina resolution'] ? pxRatio : 1;
    landCanvas.width = landCanvas.clientWidth * ratio;
    landCanvas.height = landCanvas.clientHeight * ratio;

    var ctx = landCanvas.getContext('2d');
    var W = windMeta.width, H = windMeta.height;
    var cw = landCanvas.width, ch = landCanvas.height;

    // --- 1. Fill land with shaded relief (ocean transparent) ---
    var offscreen = document.createElement('canvas');
    offscreen.width = W;
    offscreen.height = H;
    var offCtx = offscreen.getContext('2d');
    var imgData = offCtx.createImageData(W, H);

    var useRelief = shadedReliefPixels &&
        (shadedReliefPixels.width === W && shadedReliefPixels.height === H);
    var srData = useRelief ? shadedReliefPixels.data : null;

    for (var i = 0; i < windPixels.data.length; i += 4) {
        var isLand = windPixels.data[i + 2] > 128;
        if (isLand) {
            if (useRelief) {
                var relief = srData[i];
                var t = relief / 255;
                var r = 155 + t * 65;
                var g = 125 + t * 55;
                var b = 85  + t * 55;
                var noise = (Math.random() - 0.5) * 6;
                imgData.data[i]     = Math.min(255, Math.max(0, r + noise));
                imgData.data[i + 1] = Math.min(255, Math.max(0, g + noise));
                imgData.data[i + 2] = Math.min(255, Math.max(0, b + noise));
                imgData.data[i + 3] = 255;
            } else {
                var noise = (Math.random() - 0.5) * 18;
                imgData.data[i]     = 186 + noise;
                imgData.data[i + 1] = 162 + noise;
                imgData.data[i + 2] = 126 + noise;
                imgData.data[i + 3] = 255;
            }
        } else {
            imgData.data[i + 3] = 0;
        }
    }
    offCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(offscreen, 0, 0, cw, ch);

    // --- 2. Coastline lines ---
    if (window._coastlineData) {
        ctx.lineWidth = pxRatio;
        ctx.lineJoin = ctx.lineCap = 'round';
        ctx.strokeStyle = 'white';
        var data = window._coastlineData;
        ctx.beginPath();
        for (var i = 0; i < data.features.length; i++) {
            var line = data.features[i].geometry.coordinates;
            for (var j = 0; j < line.length; j++) {
                var lon = ((line[j][0] + 360) % 360);
                if (j > 0) {
                    var prevLon = ((line[j - 1][0] + 360) % 360);
                    if (Math.abs(lon - prevLon) > 180) {
                        ctx.stroke();
                        ctx.beginPath();
                        ctx.moveTo(lon * cw / 360, (-line[j][1] + 90) * ch / 180);
                        continue;
                    }
                }
                ctx[j ? 'lineTo' : 'moveTo'](
                    lon * cw / 360,
                    (-line[j][1] + 90) * ch / 180);
            }
        }
        ctx.stroke();
    }

    // --- 3. Country borders ---
    if (borderData) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(10, 9, 9, 0.4)';
        ctx.beginPath();

        for (var i = 0; i < borderData.features.length; i++) {
            var geom = borderData.features[i].geometry;
            if (!geom) continue;
            var coords = geom.coordinates;
            var lines = geom.type === 'MultiLineString' ? coords : [coords];

            for (var j = 0; j < lines.length; j++) {
                var line = lines[j];
                for (var k = 0; k < line.length; k++) {
                    var lon = ((line[k][0] + 360) % 360);
                    var lat = line[k][1];
                    if (k > 0) {
                        var prevLon = ((line[k - 1][0] + 360) % 360);
                        if (Math.abs(lon - prevLon) > 180) {
                            ctx.stroke();
                            ctx.beginPath();
                            ctx.moveTo(lon * cw / 360, (-lat + 90) * ch / 180);
                            continue;
                        }
                    }
                    ctx[k ? 'lineTo' : 'moveTo'](
                        lon * cw / 360,
                        (-lat + 90) * ch / 180);
                }
            }
        }
        ctx.stroke();
    }
}

function frame() {
    if (wind.windData) {
        wind.draw();
        updateTracers();
        drawTracers();
        drawChart();
    }
    requestAnimationFrame(frame);
}
frame();

// Sim state (was dat.GUI-bound in main; the sidebar widgets in index.html's
// inline <script> handlers now read/write these directly).
const meta = {
    'date (YYYY-MM-DD)': '2021-01-08',
    'retina resolution': true,
    showCurrents: true
};
updateWind('2021-01-08');
updateRetina();

function updateRetina() {
    const ratio = meta['retina resolution'] ? pxRatio : 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    wind.resize();
    resizeTracers();
    drawLandAndBorders();
}

function drawCoastline() {
    if (!window._coastlineData) return;
    var canvas = document.getElementById('coastline');
    if (!canvas) return;
    var ratio = (typeof meta !== 'undefined' && meta['retina resolution']) ? pxRatio : 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    if (canvas.width === 0 || canvas.height === 0) return;

    var ctx = canvas.getContext('2d');
    ctx.lineWidth = ratio;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = 'white';
    ctx.beginPath();

    var data = window._coastlineData;
    for (var i = 0; i < data.features.length; i++) {
        var line = data.features[i].geometry.coordinates;
        for (var j = 0; j < line.length; j++) {
            var lon = ((line[j][0] + 360) % 360);
            if (j > 0) {
                var prevLon = ((line[j - 1][0] + 360) % 360);
                if (Math.abs(lon - prevLon) > 180) {
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(
                        lon * canvas.width / 360,
                        (-line[j][1] + 90) * canvas.height / 180);
                    continue;
                }
            }
            ctx[j ? 'lineTo' : 'moveTo'](
                lon * canvas.width / 360,
                (-line[j][1] + 90) * canvas.height / 180);
        }
    }
    ctx.stroke();
}

getJSON('https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_coastline.geojson', function (data) {
    window._coastlineData = data;
    drawCoastline();
});

getJSON('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_boundary_lines_land.geojson', function (data) {
    borderData = data;
});

function updateWind(dateStr) {
    getJSON('oscar/' + dateStr + '.json', function (windData) {
        const windImage = new Image();
        windData.image = windImage;
        windImage.src = 'oscar/' + dateStr + '.png';
        windImage.onload = function () {
            wind.setWind(windData);
            buildWindLookup(windData);
            drawLandAndBorders();
            if (!choroplethData) initChoropleth();
        };
    });
}

function getJSON(url, callback) {
    const xhr = new XMLHttpRequest();
    xhr.responseType = 'json';
    xhr.open('get', url, true);
    xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
            callback(xhr.response);
        } else {
            throw new Error(xhr.statusText);
        }
    };
    xhr.send();
}

function buildWindLookup(data) {
    windMeta = data;
    var c = document.createElement('canvas');
    c.width = data.width;
    c.height = data.height;
    var ctx = c.getContext('2d');
    ctx.drawImage(data.image, 0, 0);
    windPixels = ctx.getImageData(0, 0, data.width, data.height);
}

function resizeTracers() {
    var ratio = meta['retina resolution'] ? pxRatio : 1;
    tracerCanvas.width = tracerCanvas.clientWidth * ratio;
    tracerCanvas.height = tracerCanvas.clientHeight * ratio;
}

function screenToTex(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    return {
        x: (clientX - rect.left) / rect.width,
        y: (clientY - rect.top) / rect.height
    };
}

function isLand(texX, texY) {
    if (!windPixels || !windMeta) return true;
    var wx = Math.floor(texX * windMeta.width) % windMeta.width;
    var wy = Math.floor(texY * windMeta.height) % windMeta.height;
    var idx = (wy * windMeta.width + wx) * 4;
    return windPixels.data[idx + 2] > 128;
}

var simMapEl = document.querySelector('.sim-map');
if (simMapEl) {
    simMapEl.addEventListener('click', function (e) {
        if (!windPixels || !windMeta) return;
        if (tracerClouds.length > 0) return;  // single-release lockout

        var tex = screenToTex(e.clientX, e.clientY);
        if (isLand(tex.x, tex.y)) return;

        var particles = [];
        var spread = 0.02;
        for (var i = 0; i < params.particleCount; i++) {
            var x = tex.x + (Math.random() - 0.5) * spread;
            var y = tex.y + (Math.random() - 0.5) * spread;
            particles.push({x: x, y: y, path: [{x: x, y: y}]});
        }
        var cloud = {particles: particles, age: 0, spreadHistory: []};
        tracerClouds.push(cloud);
        chartClouds.push(cloud);
    });
}

function updateTracers() {
    if (!windPixels || !windMeta) return;

    var W = windMeta.width, H = windMeta.height;
    var uMin = windMeta.uMin, uMax = windMeta.uMax;
    var vMin = windMeta.vMin, vMax = windMeta.vMax;
    var sf = wind.speedFactor || 0.25;
    var diff = wind.diffusion || 0;
    var lifetimeFrames = SimCore.cloudLifetimeToFrames(params.cloudLifetimeDays);

    for (var c = tracerClouds.length - 1; c >= 0; c--) {
        var cloud = tracerClouds[c];
        cloud.age++;

        if (cloud.age > lifetimeFrames) {
            tracerClouds.splice(c, 1);
            continue;
        }

        var parts = cloud.particles;
        for (var p = 0; p < parts.length; p++) {
            var pt = parts[p];

            var wx = Math.floor(pt.x * W) % W;
            var wy = Math.floor(pt.y * H) % H;
            var idx = (wy * W + wx) * 4;
            if (windPixels.data[idx + 2] > 128) continue;

            var r = windPixels.data[idx] / 255;
            var g = windPixels.data[idx + 1] / 255;

            var u = uMin + r * (uMax - uMin);
            var v = vMin + g * (vMax - vMin);

            var next = SimCore.advectStep(
                pt,
                { u: u, v: v },
                { speedFactor: sf, diffusion: diff }
            );

            var nwx = Math.floor(next.x * W) % W; if (nwx < 0) nwx += W;
            var nwy = Math.floor(next.y * H) % H; if (nwy < 0) nwy += H;
            var nidx = (nwy * W + nwx) * 4;
            if (windPixels.data[nidx + 2] > 128) continue;

            pt.x = next.x;
            pt.y = next.y;
            pt.path.push({ x: pt.x, y: pt.y });

            SimCore.accumulateHeat(heatBins, HEAT_W, HEAT_H, pt.x, pt.y);
        }

        // Spread metric, computed only over ocean-resident particles.
        var oceanParts = [];
        var activeParts = cloud.particles;
        for (var pp = 0; pp < activeParts.length; pp++) {
            var wxp = Math.floor(activeParts[pp].x * W) % W;
            var wyp = Math.floor(activeParts[pp].y * H) % H;
            if (windPixels.data[(wyp * W + wxp) * 4 + 2] > 128) continue;
            oceanParts.push(activeParts[pp]);
        }
        if (oceanParts.length >= 2) {
            cloud.spreadHistory.push(SimCore.spreadMetric(oceanParts));
        }
    }
}

// ================================================================
// CHOROPLETH (D3 + topojson) — plastic marine debris by country
// ================================================================

var choroplethSvg = (typeof d3 !== 'undefined') ? d3.select('#choropleth') : null;
var choroplethData = null;
var choroplethResizeTimer = null;

var MD_COL = 'Plastic marine debris in 2025 [tonnes/year]';
var MM_COL = 'Mismanaged plastic waste in 2025\n [tonnes]7';
var POP_COL = 'Coastal population2';

// Tooltip DOM (these elements live above the <script> tags in index.html).
var tooltipEl = document.getElementById('tooltip');
var ttName = document.getElementById('ttName');
var ttPop = document.getElementById('ttPop');
var ttMD = document.getElementById('ttMD');

// Returns a Promise so tests can await initialization.
function initChoropleth() {
    if (typeof d3 === 'undefined' || typeof topojson === 'undefined') {
        return Promise.reject(new Error('d3 / topojson not loaded'));
    }
    return Promise.all([
        d3.csv('jambeck_2014.csv'),
        d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
    ]).then(function (results) {
        var csvData = results[0];
        var topo = results[1];

        var lookup = {};
        csvData.forEach(function (d) {
            var csvName = d.Country || '';
            var neName = SimCore.NAME_MAP[csvName] || csvName;
            if (!neName) return;
            // Auto-strip trailing '8' if not in nameMap and ends with '8'
            if (!SimCore.NAME_MAP[csvName] &&
                neName.length > 1 &&
                neName[neName.length - 1] === '8') {
                neName = neName.slice(0, -1);
            }
            lookup[neName] = {
                csvName: csvName,
                coastalPop: SimCore.parseNum(d[POP_COL]),
                mm2025: SimCore.parseNum(d[MM_COL]),
                md2025: SimCore.parseNum(d[MD_COL])
            };
        });

        var countries = topojson.feature(topo, topo.objects.countries);
        choroplethData = { lookup: lookup, countries: countries };

        renderChoropleth();
        setupTooltip();
        setupLegend();
    }).catch(function (err) {
        console.error('Choropleth load failed:', err);
    });
}

function renderChoropleth() {
    if (!choroplethData || !choroplethSvg) return;
    var container = document.querySelector('.sim-map');
    if (!container) return;
    var w = container.clientWidth;
    var h = container.clientHeight;
    if (w === 0 || h === 0) return;

    choroplethSvg
        .attr('viewBox', '0 0 ' + w + ' ' + h)
        .attr('preserveAspectRatio', 'none')
        .attr('width', w)
        .attr('height', h);

    // juliosbranch's projection — relies on `.sim-map` having 2:1 aspect
    // (enforced via `aspect-ratio: 2 / 1` in the inline <style> block).
    // d3.geoEquirectangular handles antimeridian preclipping, which our
    // earlier custom transform did not — that's why prime-meridian-crossing
    // countries (France, UK, etc.) used to render as wide stripes.
    var projection = d3.geoEquirectangular()
        .rotate([180, 0])
        .scale(w / (2 * Math.PI))
        .translate([w / 2, h / 2]);

    var geoPath = d3.geoPath().projection(projection);

    var g = choroplethSvg.selectAll('g.choropleth-layer')
        .data([null])
        .join('g')
        .attr('class', 'choropleth-layer');

    var paths = g.selectAll('path.country')
        .data(choroplethData.countries.features);
    paths.exit().remove();
    var pathsEnter = paths.enter().append('path').attr('class', 'country');
    var allPaths = pathsEnter.merge(paths);

    allPaths
        .attr('d', geoPath)
        .attr('fill', function (d) {
            var data = choroplethData.lookup[d.properties.name];
            if (!data) return '#2a2a2a';
            return SimCore.logBinColor(
                data.md2025 || 0,
                SimCore.BIN_THRESHOLDS,
                SimCore.BIN_COLORS
            );
        })
        .attr('stroke', 'rgba(60, 60, 60, 0.35)')
        .attr('stroke-width', 0.5)
        .attr('data-country', function (d) { return d.properties.name; });
}

function moveTooltip(event) {
    if (!tooltipEl) return;
    var x = event.clientX + 14;
    var y = event.clientY - 12;
    var tw = tooltipEl.offsetWidth || 200;
    var th = tooltipEl.offsetHeight || 80;
    if (x + tw > window.innerWidth - 10) x = event.clientX - tw - 14;
    if (y + th > window.innerHeight - 10) y = event.clientY - th - 10;
    if (y < 10) y = 10;
    tooltipEl.style.left = x + 'px';
    tooltipEl.style.top = y + 'px';
}

function setupTooltip() {
    if (!choroplethSvg) return;
    var g = choroplethSvg.select('g.choropleth-layer');
    g.selectAll('.country')
        .on('mouseover', function (event, d) {
            var data = choroplethData.lookup[d.properties.name];
            if (!data || !data.md2025) {
                if (tooltipEl) tooltipEl.classList.remove('visible');
                return;
            }
            if (ttName) ttName.textContent = d.properties.name;
            if (ttPop)  ttPop.textContent  = SimCore.formatFull(data.coastalPop);
            if (ttMD)   ttMD.textContent   = SimCore.formatFull(data.md2025) + ' t';
            if (tooltipEl) tooltipEl.classList.add('visible');
            moveTooltip(event);
        })
        .on('mousemove', function (event) {
            if (tooltipEl && tooltipEl.classList.contains('visible')) {
                moveTooltip(event);
            }
        })
        .on('mouseout', function () {
            if (tooltipEl) tooltipEl.classList.remove('visible');
        });
}

function setupLegend() {
    var bar = document.getElementById('legendBar');
    if (!bar) return;

    var binColors = SimCore.BIN_COLORS;
    var binLabels = ['0', '1', '10', '100', '1K', '10K', '100K', '1M', '5M'];
    var numBins = binColors.length;

    // Build the gradient as inline linear-gradient (works without canvas).
    var stops = binColors.map(function (c, i) {
        var lo = (i / numBins * 100).toFixed(2);
        var hi = ((i + 1) / numBins * 100).toFixed(2);
        return c + ' ' + lo + '%, ' + c + ' ' + hi + '%';
    }).join(', ');
    bar.style.background = 'linear-gradient(to right, ' + stops + ')';

    var labelsContainer = document.getElementById('legendLabels');
    if (!labelsContainer) return;
    labelsContainer.innerHTML = '';
    for (var i = 0; i < binLabels.length; i++) {
        var el = document.createElement('span');
        el.textContent = binLabels[i];
        el.style.position = 'absolute';
        el.style.left = (i / (binLabels.length - 1) * 100) + '%';
        el.style.transform = 'translateX(-50%)';
        el.style.fontSize = '8px';
        el.style.color = '#aaa';
        el.style.whiteSpace = 'nowrap';
        labelsContainer.appendChild(el);
    }
}

function resizeChoropleth() {
    if (choroplethData) renderChoropleth();
}

// Explicitly size .sim-map to the largest 2:1 box that fits its wrapper's
// content area. CSS aspect-ratio is unreliable here: when the available
// height is the binding constraint, browsers clamp `.sim-map`'s height via
// max-height but don't shrink its width, leaving a non-2:1 box.
function fitSimMap() {
    var simMap = document.querySelector('.sim-map');
    if (!simMap) return;
    var wrapper = simMap.parentElement;
    if (!wrapper) return;

    var cs = (typeof getComputedStyle === 'function') ? getComputedStyle(wrapper) : null;
    var pl = cs ? (parseFloat(cs.paddingLeft)   || 0) : 0;
    var pr = cs ? (parseFloat(cs.paddingRight)  || 0) : 0;
    var pt = cs ? (parseFloat(cs.paddingTop)    || 0) : 0;
    var pb = cs ? (parseFloat(cs.paddingBottom) || 0) : 0;

    // wrapper.clientWidth/Height already exclude border + scrollbar; they
    // INCLUDE padding, so subtract it to get the available content box.
    var availW = wrapper.clientWidth  - pl - pr;
    var availH = wrapper.clientHeight - pt - pb;
    if (availW <= 0 || availH <= 0) return;

    var W, H;
    if (availW <= availH * 2) {
        // Width-bound — use full width, derive height
        W = availW; H = availW / 2;
    } else {
        // Height-bound — use full height, derive width
        W = availH * 2; H = availH;
    }
    simMap.style.width  = W + 'px';
    simMap.style.height = H + 'px';
}

// Unified layout-recompute. Every layer needs its internal pixel size
// updated when .sim-map's CSS box changes (e.g. window resize, devtools
// open/close, or the initial layout settling).
function recomputeLayout() {
    fitSimMap();                  // explicit 2:1 sizing of .sim-map first
    if (typeof updateRetina === 'function') {
        updateRetina();           // resizes #canvas, calls drawLandAndBorders
    }
    if (typeof resizeTracers === 'function') {
        resizeTracers();
    }
    drawCoastline();              // re-size + re-stroke
    resizeChoropleth();           // re-render at new container dims
}

if (typeof window !== 'undefined') {
    if (window.ResizeObserver) {
        // Observe the WRAPPER, not .sim-map — fitSimMap mutates .sim-map's
        // size, which would otherwise loop the observer.
        var _wrapper = document.querySelector('.sim-map-wrapper');
        if (_wrapper) {
            new ResizeObserver(function () {
                if (choroplethResizeTimer) clearTimeout(choroplethResizeTimer);
                choroplethResizeTimer = setTimeout(recomputeLayout, 100);
            }).observe(_wrapper);
        }
    }
    window.addEventListener('resize', function () {
        if (choroplethResizeTimer) clearTimeout(choroplethResizeTimer);
        choroplethResizeTimer = setTimeout(recomputeLayout, 100);
    });
    // Fire once after the initial layout settles. The initial canvas sizes
    // set during script eval read clientWidth/Height BEFORE fitSimMap has
    // had a chance to assign explicit pixel dimensions.
    requestAnimationFrame(function () {
        requestAnimationFrame(recomputeLayout);
    });
}

// ================================================================
// CURRENTS OVERLAY (smoothed polylines + arrows + labels)
// ================================================================

var currentPaths = [
    { name: 'Gulf Stream', color: '#e03030',
      path: [[-80,24],[-79,27],[-80,30],[-77,33],[-74,36],[-70,39],
             [-65,39],[-58,41],[-50,40],[-42,43]] },
    { name: 'N. Atlantic Drift', color: '#e03030',
      path: [[-42,47],[-36,49],[-29,50],[-22,52],[-15,55],[-8,57],[0,58]] },
    { name: 'Kuroshio', color: '#e03030',
      path: [[117,18],[124,22],[132,26],[128,29],[135,32],
             [139,34],[142,35],[150,34],[158,35],[166,36]] },
    { name: 'N. Pacific Current', color: '#e03030',
      path: [[166,38],[174,39],[180,40],[-175,40],[-170,39],
             [-164,38],[-156,37],[-148,36],[-140,35]] },
    { name: 'North Equatorial (Pacific)', color: '#e03030',
      path: [[-170,15],[-160,15],[-150,14],[-140,14],[-130,13],[-120,13],[-110,12]] },
    { name: 'N. Eq. (Atlantic)', color: '#e03030',
      path: [[-55,8],[-45,7],[-35,7],[-25,6],[-15,5]] },
    { name: 'South Equatorial (Pacific)', color: '#e03030',
      path: [[-170,-3],[-160,-3],[-150,-3],[-140,-3],[-130,-3],
             [-120,-3],[-110,-3],[-100,-3],[-90,-3]] },
    { name: 'S. Eq. (Atlantic)', color: '#e03030',
      path: [[-40,-1],[-30,-1],[-20,-1],[-10,0],[-1,0]] },
    { name: 'Eq. Countercurrent', color: '#e03030',
      path: [[150,5],[160,6],[170,7],[180,7],[-170,7],[-160,7],[-150,6],[-140,5]] },
    { name: 'Brazil Current', color: '#e03030',
      path: [[-36,-15],[-36,-19],[-36,-23],[-43,-28],[-45,-32],[-49,-36],[-52,-40],[-54,-45]] },
    { name: 'E. Australia', color: '#e03030',
      path: [[156,-25],[157,-29],[157,-33],[154,-36],[153,-39],[152,-41]] },
    { name: 'Agulhas', color: '#e03030',
      path: [[43,-15],[40,-20],[38,-23],[36,-26],[35,-29],[33,-32],[26,-36],[27,-38],[40,-40]] },
    { name: 'Alaska Current', color: '#e03030',
      path: [[-132,48],[-135,50],[-139,53],[-144,55],[-150,56],[-156,55]] },
    { name: 'Monsoon Drift', color: '#e03030',
      path: [[95,-2],[85,-2],[75,-2],[65,-2],[55,-1],[45,0]] }
];

function drawSmoothPath(ctx, pts) {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 0; i < pts.length - 1; i++) {
        var mx = (pts[i].x + pts[i + 1].x) / 2;
        var my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
}

function drawArrow(ctx, x, y, angle, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size * 1.2, -size * 0.4);
    ctx.lineTo(-size * 0.7, 0);
    ctx.lineTo(-size * 1.2, size * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// Pure-ish: takes ctx, current array, and {showCurrents, cw, ch}.
// Returns immediately for showCurrents=false or zero canvas size, so all
// gating happens here. The call site in drawTracers passes live globals.
function drawCurrents(ctx, currents, opts) {
    opts = opts || {};
    if (opts.showCurrents === false) return;
    var cw = opts.cw;
    var ch = opts.ch;
    if (!cw || !ch) return;

    for (var i = 0; i < currents.length; i++) {
        var cur = currents[i];
        var segments = [];
        var seg = [];

        for (var j = 0; j < cur.path.length; j++) {
            var lon = cur.path[j][0];
            var lat = cur.path[j][1];
            var tx = ((lon + 360) % 360) / 360 * cw;
            var ty = (90 - lat) / 180 * ch;

            if (seg.length > 0) {
                var lastX = seg[seg.length - 1].x;
                if (Math.abs(tx - lastX) > cw * 0.5) {
                    segments.push(seg);
                    seg = [];
                }
            }
            seg.push({ x: tx, y: ty });
        }
        if (seg.length > 0) segments.push(seg);
        if (segments.length === 0) continue;

        ctx.lineWidth = 10;
        ctx.strokeStyle = cur.color;
        ctx.globalAlpha = 0.85;

        for (var s = 0; s < segments.length; s++) {
            var sg = segments[s];
            if (sg.length < 2) continue;
            drawSmoothPath(ctx, sg);

            var last = sg.length - 1;
            var dx = sg[last].x - sg[Math.max(0, last - 1)].x;
            var dy = sg[last].y - sg[Math.max(0, last - 1)].y;
            if (dx !== 0 || dy !== 0) {
                var angle = Math.atan2(dy, dx);
                ctx.fillStyle = cur.color;
                drawArrow(ctx, sg[last].x, sg[last].y, angle, 8);
            }
        }

        // Label on the longest segment, oriented to flow direction
        var bestSeg = segments[0];
        for (var s2 = 1; s2 < segments.length; s2++) {
            if (segments[s2].length > bestSeg.length) bestSeg = segments[s2];
        }
        var mi = Math.floor(bestSeg.length / 2);
        var ldx = bestSeg[Math.min(bestSeg.length - 1, mi + 1)].x
                - bestSeg[Math.max(0, mi - 1)].x;
        var ldy = bestSeg[Math.min(bestSeg.length - 1, mi + 1)].y
                - bestSeg[Math.max(0, mi - 1)].y;
        var langle = Math.atan2(ldy, ldx);
        if (Math.cos(langle) < 0) langle += Math.PI;

        ctx.save();
        ctx.translate(bestSeg[mi].x, bestSeg[mi].y);
        ctx.rotate(langle);
        ctx.globalAlpha = 0.95;
        ctx.font = 'bold 25px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 3;
        ctx.strokeText(cur.name, 0, 0);
        ctx.fillStyle = '#fff';
        ctx.fillText(cur.name, 0, 0);
        ctx.restore();
    }
    ctx.globalAlpha = 1;
}

function drawTracers() {
    var ratio = meta['retina resolution'] ? pxRatio : 1;
    var w = tracerCanvas.width;
    var h = tracerCanvas.height;

    tracerCtx.clearRect(0, 0, w, h);

    drawHeatmap();
    drawCurrents(tracerCtx, currentPaths, {
        showCurrents: meta.showCurrents,
        cw: w,
        ch: h
    });

    if (tracerClouds.length === 0) return;

    tracerCtx.strokeStyle = '#c8f03c';
    tracerCtx.fillStyle = '#c8f03c';
    tracerCtx.lineWidth = 1.5 * ratio;

    for (var c = 0; c < tracerClouds.length; c++) {
        var parts = tracerClouds[c].particles;
        for (var p = 0; p < parts.length; p++) {
            var path = parts[p].path;

            if (params.showTrajectories && path.length >= 2) {
                tracerCtx.beginPath();
                var prevX = path[0].x;
                tracerCtx.moveTo(path[0].x * w, path[0].y * h);
                for (var i = 1; i < path.length; i++) {
                    if (Math.abs(path[i].x - prevX) > 0.5) {
                        tracerCtx.stroke();
                        tracerCtx.beginPath();
                        tracerCtx.moveTo(path[i].x * w, path[i].y * h);
                    } else {
                        tracerCtx.lineTo(path[i].x * w, path[i].y * h);
                    }
                    prevX = path[i].x;
                }
                tracerCtx.stroke();
            }

            var fx = parts[p].x * w;
            var fy = parts[p].y * h;
            tracerCtx.beginPath();
            tracerCtx.arc(fx, fy, LEAD_CIRCLE_R * ratio, 0, Math.PI * 2);
            tracerCtx.fill();
        }
    }
}

resizeTracers();

// Expose state references for tests + the inline <script> handlers in index.html.
// (const-declared bindings like `meta` are not auto-promoted to window.)
if (typeof window !== 'undefined') {
    window.params = params;
    window.tracerClouds = tracerClouds;
    window.chartClouds = chartClouds;
    window.heatBins = heatBins;
    window.meta = meta;
}