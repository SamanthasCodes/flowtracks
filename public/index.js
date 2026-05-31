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
        chartCtx.fillStyle = 'rgba(240,237,232,0.2)';
        chartCtx.font = '14px "Cormorant SC", serif';
        chartCtx.textAlign = 'center';
        chartCtx.fillText('Release particles to track spread', cw / 2, ch / 2);
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

    var padL = 28, padR = 6, padT = 16, padB = 18;
    var plotW = cw - padL - padR;
    var plotH = ch - padT - padB;

    chartCtx.strokeStyle = 'rgba(74,216,192,0.12)';
    chartCtx.lineWidth = 0.5;
    for (var i = 0; i <= 3; i++) {
        var y = padT + plotH * i / 3;
        chartCtx.beginPath();
        chartCtx.moveTo(padL, y);
        chartCtx.lineTo(padL + plotW, y);
        chartCtx.stroke();
    }

    chartCtx.fillStyle = 'rgba(240,237,232,0.3)';
    chartCtx.font = '11px "Cormorant", serif';
    chartCtx.textAlign = 'right';
    chartCtx.fillText((maxSpread * 360).toFixed(1) + '\u00b0', padL - 3, padT + 8);
    chartCtx.fillText('0', padL - 3, padT + plotH + 3);

    // Rotated LONGITUDE y-axis label
    chartCtx.save();
    chartCtx.fillStyle = 'rgba(240,237,232,0.25)';
    chartCtx.font = '11px "Cormorant SC", serif';
    chartCtx.textAlign = 'center';
    chartCtx.translate(8, padT + plotH / 2);
    chartCtx.rotate(-Math.PI / 2);
    chartCtx.fillText('LONGITUDE', 0, 0);
    chartCtx.restore();

    // STEPS x-axis label
    chartCtx.fillStyle = 'rgba(240,237,232,0.25)';
    chartCtx.font = '11px "Cormorant SC", serif';
    chartCtx.textAlign = 'center';
    chartCtx.fillText('STEPS', padL + plotW / 2, ch - 2);

    var colors = ['#c8f03c', '#4dd8c0', '#2ab8a0', '#f0c83c', '#a8e040', '#7dd8c0'];
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

const gui = new dat.GUI();
gui.add(wind, 'numParticles', 1024, 65536);
gui.add(wind, 'fadeOpacity', 0.9, 0.999).step(0.001).updateDisplay();
gui.add(wind, 'speedFactor', 0.5, 3.0);
gui.add(wind, 'dropRate', 0, 0.05);
gui.add(wind, 'dropRateBump', 0, 0.2);
gui.add(wind, 'diffusion', 0, 0.002).step(0.0001);

const meta = {
    'date (YYYY-MM-DD)': '2021-01-08',
    'retina resolution': true,
    showCurrents: true
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