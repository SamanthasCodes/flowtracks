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

let windPixels = null;
let windMeta = null;

let tracerClouds = [];
const CLOUD_MAX_AGE = 5000;
const TRACER_COUNT = 50;
const LEAD_CIRCLE_R = 2;
var HEAT_W = 360;
var HEAT_H = 180;
var heatBins = new Float32Array(HEAT_W * HEAT_H);
var heatCanvas = document.createElement('canvas');
heatCanvas.width = HEAT_W;
heatCanvas.height = HEAT_H;
var heatCtx = heatCanvas.getContext('2d');

var chartClouds = [];
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

function heatmapColor(t) {
    var r, g, b;
    if (t < 0.25)
      { r = 0;     g = t * 4;        b = 1; }
    else if (t < 0.5)
      { r = (t - 0.25) * 4;  g = 1; b = 1 - (t - 0.25) * 4; }
    else if (t < 0.75)
      { r = 1;     g = 1 - (t - 0.5) * 4;  b = 0; }
    else
      { r = 1;     g = 0;                 b = 0; }
    return [Math.floor(r * 255), Math.floor(g * 255), Math.floor(b * 255)];
}

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
            var col = heatmapColor(v);
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

var chartCanvas = document.createElement('canvas');
chartCanvas.width = 280;
chartCanvas.height = 200;
chartCanvas.style.cssText = [
    'position:fixed',
    'bottom:10px',
    'right:10px',
    'background:rgba(0,0,0,0.7)',
    'border:1px solid #040404',
    'border-radius:4px',
    'z-index:100'
].join(';');
document.body.appendChild(chartCanvas);
var chartCtx = chartCanvas.getContext('2d');

function drawChart() {
    var cw = chartCanvas.width, ch = chartCanvas.height;
    chartCtx.clearRect(0, 0, cw, ch);

    chartCtx.fillStyle = 'rgba(0,0,0,0.75)';
    chartCtx.fillRect(0, 0, cw, ch);

    chartCtx.fillStyle = '#ccc';
    chartCtx.font = '11px sans-serif';
    chartCtx.fillText('Cloud spread over time', 8, 16);

    if (chartClouds.length === 0) {
        chartCtx.fillStyle = '#666';
        chartCtx.font = '10px sans-serif';
        chartCtx.textAlign = 'center';
        chartCtx.fillText('Click the ocean to release particles', cw / 2, ch / 2);
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

    var padL = 35, padR = 8, padT = 24, padB = 18;
    var plotW = cw - padL - padR;
    var plotH = ch - padT - padB;

    chartCtx.strokeStyle = '#444';
    chartCtx.lineWidth = 0.5;
    for (var i = 0; i <= 4; i++) {
        var y = padT + plotH * i / 4;
        chartCtx.beginPath();
        chartCtx.moveTo(padL, y);
        chartCtx.lineTo(padL + plotW, y);
        chartCtx.stroke();
    }

    chartCtx.fillStyle = '#888';
    chartCtx.font = '9px sans-serif';
    chartCtx.textAlign = 'right';
    chartCtx.fillText((maxSpread * 360).toFixed(1) + '\u00b0', padL - 4, padT + 10);
    chartCtx.fillText('0', padL - 4, padT + plotH + 4);

    chartCtx.textAlign = 'center';
    chartCtx.fillText('0', padL, padT + plotH + 14);
    chartCtx.fillText(maxAge, padL + plotW, padT + plotH + 14);
    chartCtx.fillStyle = '#666';
    chartCtx.font = '9px sans-serif';
    chartCtx.fillText('Time step', padL + plotW / 2, padT + plotH + 14);

    var colors = ['#ff3333', '#33ff33', '#33ccff', '#ffcc33', '#ff33cc', '#33ffcc'];
    for (var c = 0; c < chartClouds.length; c++) {
        var hist = chartClouds[c].spreadHistory;
        if (hist.length < 2) continue;

        chartCtx.strokeStyle = colors[c % colors.length];
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

const gui = new dat.GUI();
gui.add(wind, 'numParticles', 1024, 65536);
gui.add(wind, 'fadeOpacity', 0.9, 0.999).step(0.001).updateDisplay();
gui.add(wind, 'speedFactor', 0.5, 3.0);
gui.add(wind, 'dropRate', 0, 0.05);
gui.add(wind, 'dropRateBump', 0, 0.2);
gui.add(wind, 'diffusion', 0, 0.002).step(0.0001);

const meta = {
    'date (YYYY-MM-DD)': '2021-01-08',
    'retina resolution': true
};
gui.add(meta, 'date (YYYY-MM-DD)').onFinishChange(function (val) {
    updateWind(val);
});
if (pxRatio !== 1) {
    gui.add(meta, 'retina resolution').onFinishChange(updateRetina);
}
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

getJSON('https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_coastline.geojson', function (data) {
    window._coastlineData = data;
    const canvas = document.getElementById('coastline');
    canvas.width = canvas.clientWidth * pxRatio;
    canvas.height = canvas.clientHeight * pxRatio;

    const ctx = canvas.getContext('2d');
    ctx.lineWidth = pxRatio;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = 'white';
    ctx.beginPath();

    for (let i = 0; i < data.features.length; i++) {
        const line = data.features[i].geometry.coordinates;
        for (let j = 0; j < line.length; j++) {
            const lon = ((line[j][0] + 360) % 360);
            if (j > 0) {
                const prevLon = ((line[j-1][0] + 360) % 360);
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

canvas.addEventListener('click', function (e) {
    if (!windPixels || !windMeta) return;

    var tex = screenToTex(e.clientX, e.clientY);
    if (isLand(tex.x, tex.y)) return;

    var particles = [];
    var spread = 0.02;
    for (var i = 0; i < TRACER_COUNT; i++) {
        var x = tex.x + (Math.random() - 0.5) * spread;
        var y = tex.y + (Math.random() - 0.5) * spread;
        particles.push({x: x, y: y, path: [{x: x, y: y}]});
    }
    var cloud = {particles: particles, age: 0, spreadHistory: []};
    tracerClouds.push(cloud);
    chartClouds.push(cloud);

});

function updateTracers() {
    if (!windPixels || !windMeta) return;

    var W = windMeta.width, H = windMeta.height;
    var uMin = windMeta.uMin, uMax = windMeta.uMax;
    var vMin = windMeta.vMin, vMax = windMeta.vMax;
    var sf = wind.speedFactor || 0.25;
    var diff = wind.diffusion || 0;

    for (var i = 0; i < heatBins.length; i++) heatBins[i] *= 0.997;

    for (var c = tracerClouds.length - 1; c >= 0; c--) {
        var cloud = tracerClouds[c];
        cloud.age++;

        if (cloud.age > CLOUD_MAX_AGE) {
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

            var latRad = (pt.y * 180 - 90) * Math.PI / 180;
            var distortion = Math.cos(latRad);
            var dTexX = (u / Math.max(distortion, 0.01)) * 0.0001 * sf;
            var dTexY = -v * 0.0001 * sf;

            var dDiffX = (Math.random() - 0.5) * 2 * diff;
            var dDiffY = (Math.random() - 0.5) * 2 * diff;

            var newX = (pt.x + dTexX + dDiffX);
            var newY = (pt.y + dTexY + dDiffY);

            var nwx = Math.floor(newX * W) % W; if (nwx < 0) nwx += W;
            var nwy = Math.floor(newY * H) % H; if (nwy < 0) nwy += H;
            var nidx = (nwy * W + nwx) * 4;
            if (windPixels.data[nidx + 2] > 128) continue;

            pt.x = newX % 1; if (pt.x < 0) pt.x += 1;
            pt.y = newY % 1; if (pt.y < 0) pt.y += 1;

            pt.path.push({x: pt.x, y: pt.y});

            var bx = Math.floor(pt.x * HEAT_W) % HEAT_W;
            var by = Math.floor(pt.y * HEAT_H) % HEAT_H;
            heatBins[by * HEAT_W + bx]++;
        }

        var cx = 0, cy = 0, count = 0;
        var activeParts = cloud.particles;
        for (var pp = 0; pp < activeParts.length; pp++) {
            var wx = Math.floor(activeParts[pp].x * W) % W;
            var wy = Math.floor(activeParts[pp].y * H) % H;
            var idx2 = (wy * W + wx) * 4;
            if (windPixels.data[idx2 + 2] > 128) continue;
            cx += activeParts[pp].x;
            cy += activeParts[pp].y;
            count++;
        }
        if (count > 1) {
            cx /= count;
            cy /= count;
            var spread = 0;
            for (var pp = 0; pp < activeParts.length; pp++) {
                var wx = Math.floor(activeParts[pp].x * W) % W;
                var wy = Math.floor(activeParts[pp].y * H) % H;
                var idx2 = (wy * W + wx) * 4;
                if (windPixels.data[idx2 + 2] > 128) continue;
                var dx = activeParts[pp].x - cx;
                var dy = activeParts[pp].y - cy;
                if (dx > 0.5) dx -= 1;
                if (dx < -0.5) dx += 1;
                spread += Math.sqrt(dx * dx + dy * dy);
            }
            spread /= count;
            cloud.spreadHistory.push(spread);
        }
    }
}

function drawTracers() {
    var ratio = meta['retina resolution'] ? pxRatio : 1;
    var w = tracerCanvas.width;
    var h = tracerCanvas.height;

    tracerCtx.clearRect(0, 0, w, h);

    drawHeatmap();

    if (tracerClouds.length === 0) return;

    tracerCtx.strokeStyle = '#ff3333';
    tracerCtx.fillStyle = '#ff3333';
    tracerCtx.lineWidth = 1.5 * ratio;

    for (var c = 0; c < tracerClouds.length; c++) {
        var parts = tracerClouds[c].particles;
        for (var p = 0; p < parts.length; p++) {
            var path = parts[p].path;
            if (path.length < 2) continue;

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

            var fx = parts[p].x * w;
            var fy = parts[p].y * h;
            tracerCtx.beginPath();
            tracerCtx.arc(fx, fy, LEAD_CIRCLE_R * ratio, 0, Math.PI * 2);
            tracerCtx.fill();
        }
    }
}

resizeTracers();
