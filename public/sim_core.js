// Pure-math helpers for the FlowTracks simulation.
//
// Loaded by index.html as a plain <script> (no module syntax) — registers
// itself on globalThis.SimCore so the browser sees window.SimCore. Tests
// `import` this file for its side effects and then read globalThis.SimCore.
//
// Keep this file dependency-free and side-effect-free apart from the single
// `globalThis.SimCore = ...` assignment.

(function () {
    var SECONDS_PER_FRAME = 4000;

    var BIN_THRESHOLDS = [0, 1, 10, 100, 1000, 10000, 100000, 1000000, 5000000];
    var BIN_COLORS = [
        '#ffffcc', '#ffeda0', '#fed976', '#feb24c',
        '#fd8d3c', '#fc4e2a', '#e31a1c', '#b10026'
    ];

    var NAME_MAP = {
        'Antigua & Barbuda': 'Antigua and Barbuda',
        'Bosnia and Herzegovina': 'Bosnia and Herz.',
        'Burma/Myanmar': 'Myanmar',
        "Cote d'Ivoire": "Côte d'Ivoire",
        'Central African Rep.': 'Central African Rep.',
        'Congo, Dem. Rep.8': 'Dem. Rep. Congo',
        'East Timor': 'Timor-Leste',
        'Tunisia': 'Tunisia',
        'Equatorial Guinea': 'Equatorial Guinea',
        'The Gambia': 'Gambia',
        'Korea, North': 'North Korea',
        'Korea, South (Republic of Korea)': 'South Korea',
        'Macedonia': 'North Macedonia',
        'St. Kitts & Nevis': 'Saint Kitts and Nevis',
        'St. Lucia': 'Saint Lucia',
        'St. Vincent & the Grenadines': 'Saint Vincent and the Grenadines',
        'Trinidad & Tobago': 'Trinidad and Tobago',
        'United States': 'United States of America',
        'Vietnam8': 'Vietnam',
        'Congo Rep of': 'Congo',
        'Congo, Dem rep. of': 'Dem. Rep. Congo',
        "Cote d'Ivoire8": "Côte d'Ivoire",
        'Saudi Arabia8': 'Saudi Arabia',
        'United Arab Emirates8': 'United Arab Emirates',
        'Algeria8': 'Algeria',
        'Colombia8': 'Colombia',
        'Croatia8': 'Croatia',
        'Dominican Rep.': 'Dominican Rep.',
        'Ghana8': 'Ghana',
        'Iran8': 'Iran',
        'Jordan8': 'Jordan',
        'Namibia8': 'Namibia',
        'Nigeria8': 'Nigeria',
        'Pakistan8': 'Pakistan',
        'Sao Tome and Principe8': 'Sao Tome and Principe',
        'Senegal8': 'Senegal',
        'Solomon Islands8': 'Solomon Islands',
        'Thailand8': 'Thailand',
        'United Republic of Tanzania8': 'Tanzania',
        'Venezuela8': 'Venezuela'
    };

    function cloudLifetimeToFrames(days, secondsPerFrame) {
        if (secondsPerFrame === undefined) secondsPerFrame = SECONDS_PER_FRAME;
        return Math.floor(days * 86400 / secondsPerFrame);
    }

    function wrap01(v) {
        var w = v % 1;
        if (w < 0) w += 1;
        return w;
    }

    // Pure advection step. Inputs are immutable — returns a new {x, y}.
    //   pt       : { x, y } in [0, 1] texture coords (y=0 north pole, y=1 south)
    //   sample   : { u, v } current speed in m/s (juliosbranch's normalized units)
    //   opts.speedFactor : multiplier (juliosbranch default 0.25)
    //   opts.diffusion   : random-walk amplitude in tex coords (0..0.002)
    //   opts.rng         : optional () => [0, 1); defaults to Math.random
    // Mirrors juliosbranch:public/index.js updateTracers per-particle math.
    function advectStep(pt, sample, opts) {
        var sf = opts.speedFactor;
        var diff = opts.diffusion || 0;
        var rng = opts.rng || Math.random;

        var latRad = (pt.y * 180 - 90) * Math.PI / 180;
        var distortion = Math.cos(latRad);
        var dTexX = (sample.u / Math.max(distortion, 0.01)) * 0.0001 * sf;
        var dTexY = -sample.v * 0.0001 * sf;

        var dDiffX = (rng() - 0.5) * 2 * diff;
        var dDiffY = (rng() - 0.5) * 2 * diff;

        return {
            x: wrap01(pt.x + dTexX + dDiffX),
            y: wrap01(pt.y + dTexY + dDiffY)
        };
    }

    // Mean distance from the antimeridian-unwrapped centroid of `parts`.
    // Unwraps relative to parts[0] (juliosbranch's convention). Returns 0
    // for fewer than 2 points.
    function spreadMetric(parts) {
        if (!parts || parts.length < 2) return 0;

        var refX = parts[0].x;
        var refY = parts[0].y;
        var sumX = 0, sumY = 0, count = 0;

        for (var i = 0; i < parts.length; i++) {
            var dx = parts[i].x - refX;
            if (dx > 0.5) dx -= 1;
            if (dx < -0.5) dx += 1;
            var dy = parts[i].y - refY;
            sumX += refX + dx;
            sumY += refY + dy;
            count++;
        }
        if (count < 2) return 0;

        var cx = sumX / count;
        var cy = sumY / count;
        if (cx < 0) cx += 1;
        if (cx >= 1) cx -= 1;

        var spread = 0;
        for (var j = 0; j < parts.length; j++) {
            var dxj = parts[j].x - cx;
            if (dxj > 0.5) dxj -= 1;
            if (dxj < -0.5) dxj += 1;
            var dyj = parts[j].y - cy;
            spread += Math.sqrt(dxj * dxj + dyj * dyj);
        }
        return spread / count;
    }

    function resolveCountryName(csvName, nameMap) {
        if (nameMap && Object.prototype.hasOwnProperty.call(nameMap, csvName)) {
            return nameMap[csvName];
        }
        return csvName;
    }

    // Returns colors[i] such that thresholds[i] <= value < thresholds[i+1].
    // value < thresholds[0] returns colors[0]; values past the last threshold
    // clamp to the last color (works even when colors.length === thresholds.length - 1,
    // which is how juliosbranch's choropleth is configured).
    function logBinColor(value, thresholds, colors) {
        var i = 0;
        while (i < thresholds.length - 1 && value >= thresholds[i + 1]) {
            i++;
        }
        if (i >= colors.length) i = colors.length - 1;
        return colors[i];
    }

    // juliosbranch's rainbow heatmap palette: blue -> cyan -> yellow -> red.
    function heatmapColor(t) {
        var r, g, b;
        if (t < 0.25) {
            r = 0;            g = t * 4;          b = 1;
        } else if (t < 0.5) {
            r = (t - 0.25) * 4; g = 1;            b = 1 - (t - 0.25) * 4;
        } else if (t < 0.75) {
            r = 1;            g = 1 - (t - 0.5) * 4; b = 0;
        } else {
            r = 1;            g = 0;              b = 0;
        }
        return [Math.floor(r * 255), Math.floor(g * 255), Math.floor(b * 255)];
    }

    // Increment the bin under (texX, texY). No decay.
    function accumulateHeat(bins, w, h, texX, texY) {
        var bx = Math.floor(texX * w) % w;
        var by = Math.floor(texY * h) % h;
        if (bx < 0) bx += w;
        if (by < 0) by += h;
        bins[by * w + bx]++;
    }

    function parseNum(str) {
        if (!str) return 0;
        return parseFloat(String(str).replace(/[,\s]/g, '')) || 0;
    }

    function formatNum(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1) + ' M';
        if (n >= 1e3) return (n / 1e3).toFixed(0) + ' K';
        return n.toFixed(0);
    }

    function formatFull(n) {
        return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }

    globalThis.SimCore = {
        SECONDS_PER_FRAME: SECONDS_PER_FRAME,
        BIN_THRESHOLDS: BIN_THRESHOLDS,
        BIN_COLORS: BIN_COLORS,
        NAME_MAP: NAME_MAP,
        cloudLifetimeToFrames: cloudLifetimeToFrames,
        wrap01: wrap01,
        advectStep: advectStep,
        spreadMetric: spreadMetric,
        resolveCountryName: resolveCountryName,
        logBinColor: logBinColor,
        heatmapColor: heatmapColor,
        accumulateHeat: accumulateHeat,
        parseNum: parseNum,
        formatNum: formatNum,
        formatFull: formatFull
    };
})();
