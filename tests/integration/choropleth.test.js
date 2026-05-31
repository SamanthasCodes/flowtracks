// Phase 4 — choropleth DOM + tooltip integration tests.
//
// Loads real d3 + real topojson-client into the jsdom window, stubs d3.csv /
// d3.json to return a 3-country fixture, evals sim_core.js + index.js, then
// awaits initChoropleth() to verify rendered country paths, hover tooltip,
// and that click events still bubble to .sim-map (the pointer-events guarantee
// from the analysis doc).
//
// Run:
//   npm test -- tests/integration/choropleth.test.js

import { describe, test, expect, beforeEach } from 'vitest';
import * as d3 from 'd3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

// ----- Fixtures --------------------------------------------------------------

const FIXTURE_CSV_ROWS = [
    {
        Country: 'United States',
        'Coastal population2': '40,002,981',
        'Mismanaged plastic waste in 2025\n [tonnes]7': '110,000',
        'Plastic marine debris in 2025 [tonnes/year]': '275,424'
    },
    {
        Country: 'China',
        'Coastal population2': '262,892,387',
        'Mismanaged plastic waste in 2025\n [tonnes]7': '17,814,777',
        'Plastic marine debris in 2025 [tonnes/year]': '5,344,433'
    },
    {
        Country: 'Indonesia',
        'Coastal population2': '187,223,476',
        'Mismanaged plastic waste in 2025\n [tonnes]7': '7,415,202',
        'Plastic marine debris in 2025 [tonnes/year]': '2,224,561'
    }
];

const FIXTURE_GEOJSON = {
    type: 'FeatureCollection',
    features: [
        {
            type: 'Feature',
            properties: { name: 'United States of America' },
            geometry: { type: 'Polygon', coordinates: [[
                [-120, 30], [-100, 30], [-100, 50], [-120, 50], [-120, 30]
            ]] }
        },
        {
            type: 'Feature',
            properties: { name: 'China' },
            geometry: { type: 'Polygon', coordinates: [[
                [100, 30], [120, 30], [120, 50], [100, 50], [100, 30]
            ]] }
        },
        {
            type: 'Feature',
            properties: { name: 'Indonesia' },
            geometry: { type: 'Polygon', coordinates: [[
                [100, -10], [120, -10], [120, 10], [100, 10], [100, -10]
            ]] }
        }
    ]
};

const PAGE_FIXTURE = `
<div class="page">
    <div class="sim-body">
        <div class="sim-map">
            <canvas id="coastline"></canvas>
            <canvas id="canvas"></canvas>
            <canvas id="land"></canvas>
            <svg id="choropleth"></svg>
            <div id="legend">
                <div class="legend-title">Plastic marine debris</div>
                <div class="legend-bar-container">
                    <div class="legend-bar" id="legendBar"></div>
                </div>
                <div class="legend-labels" id="legendLabels"></div>
                <div class="legend-unit">tonnes / year (log scale)</div>
            </div>
            <canvas id="tracers"></canvas>
        </div>
    </div>
    <div class="sim-footer">
        <button class="sim-footer-reset" onclick="resetSim()">RESET</button>
    </div>
</div>
<div id="tooltip">
    <div class="tt-name" id="ttName"></div>
    <div class="tt-row"><span class="tt-label">Coastal population</span><span class="tt-value" id="ttPop"></span></div>
    <div class="tt-row"><span class="tt-label">Marine debris (2025)</span><span class="tt-value" id="ttMD"></span></div>
</div>
`;

// ----- Stub helpers ----------------------------------------------------------

const NOOP = () => {};

function makeMock2D() {
    return new Proxy({}, {
        get(_, prop) {
            if (prop === 'createImageData' || prop === 'getImageData') {
                return (a, b, c, d) => {
                    const w = c ?? a, h = d ?? b;
                    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
                };
            }
            return NOOP;
        },
        set: () => true
    });
}

function readPublic(name) {
    return fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
}

function bootstrap() {
    document.head.innerHTML = '';
    document.body.innerHTML = PAGE_FIXTURE;

    // Fix clientWidth/Height on .sim-map so renderChoropleth doesn't short-circuit
    const simMap = document.querySelector('.sim-map');
    Object.defineProperty(simMap, 'clientWidth',  { value: 800, configurable: true });
    Object.defineProperty(simMap, 'clientHeight', { value: 400, configurable: true });

    // Canvas stubs (WebGL + 2D)
    HTMLCanvasElement.prototype.getContext = function (type) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
            return {};
        }
        return makeMock2D();
    };
    HTMLCanvasElement.prototype.getBoundingClientRect = function () {
        return { left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50, x: 0, y: 0 };
    };

    // Top-level dependencies index.js expects
    window.WindGL = function () {
        this.diffusion = 0.001; this.numParticles = 65000;
        this.speedFactor = 0.25; this.windData = null;
        this.setWind = NOOP; this.draw = NOOP; this.resize = NOOP;
    };
    window.dat = { GUI: function () {
        const f = {}; ['add','step','name','onFinishChange','updateDisplay']
            .forEach(m => f[m] = () => f);
        f.domElement = document.createElement('div');
        return f;
    } };
    window.requestAnimationFrame = () => 0;
    window.XMLHttpRequest = class { constructor(){this.onload=null;} open(){} send(){} };
    window.Image = class { constructor(){this.onload=null;} set src(_){} };
    window.devicePixelRatio = 1;

    // Inject real d3 + tiny topojson stub. The d3 ESM namespace is frozen, so
    // we wrap it in a prototype object that lets us shadow csv/json with fixtures.
    const d3Stubbed = Object.create(d3);
    d3Stubbed.csv = () => Promise.resolve(FIXTURE_CSV_ROWS);
    // The shape only needs to satisfy `topo.objects.countries` access in
    // initChoropleth — our topojson.feature stub ignores the value.
    d3Stubbed.json = () => Promise.resolve({ objects: { countries: {} } });
    window.d3 = d3Stubbed;
    window.topojson = { feature: () => FIXTURE_GEOJSON };

    // Eval scripts (sim_core first, then index.js — same order as index.html).
    window.eval(readPublic('sim_core.js'));
    window.eval(readPublic('index.js'));
}

// ----- Tests -----------------------------------------------------------------

describe('Phase 4 — choropleth render', () => {
    beforeEach(bootstrap);

    test('60. after initChoropleth, ≥3 path.country elements exist', async () => {
        await window.initChoropleth();
        const paths = document.querySelectorAll('#choropleth path.country');
        expect(paths.length).toBeGreaterThanOrEqual(3);
    });

    test('61. China path fill === #b10026 (top bin)', async () => {
        await window.initChoropleth();
        const china = document.querySelector('#choropleth path.country[data-country="China"]');
        expect(china).not.toBeNull();
        expect(china.getAttribute('fill')).toBe('#b10026');
    });

    test('62. Indonesia path fill === #b10026 (top bin)', async () => {
        await window.initChoropleth();
        const indonesia = document.querySelector('#choropleth path.country[data-country="Indonesia"]');
        expect(indonesia).not.toBeNull();
        expect(indonesia.getAttribute('fill')).toBe('#b10026');
    });
});

describe('Phase 4 — tooltip', () => {
    beforeEach(bootstrap);

    function dispatchOn(el, type, init = {}) {
        const evt = new window.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
        el.dispatchEvent(evt);
    }

    test('63. mouseover USA path sets #ttName + adds .visible class', async () => {
        await window.initChoropleth();
        const usa = document.querySelector('#choropleth path.country[data-country="United States of America"]');
        dispatchOn(usa, 'mouseover', { clientX: 50, clientY: 50 });

        expect(document.getElementById('ttName').textContent).toBe('United States of America');
        expect(document.getElementById('tooltip').classList.contains('visible')).toBe(true);
    });

    test('64. mouseout removes .visible class', async () => {
        await window.initChoropleth();
        const usa = document.querySelector('#choropleth path.country[data-country="United States of America"]');
        dispatchOn(usa, 'mouseover', { clientX: 50, clientY: 50 });
        expect(document.getElementById('tooltip').classList.contains('visible')).toBe(true);
        dispatchOn(usa, 'mouseout');
        expect(document.getElementById('tooltip').classList.contains('visible')).toBe(false);
    });
});

describe('Phase 4 — pointer-events regression', () => {
    beforeEach(() => {
        bootstrap();
        // Make ocean clicks register: clickable ocean at center of canvas.
        const W = 4, H = 4;
        const data = new Uint8ClampedArray(W * H * 4);
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 128; data[i+1] = 128; data[i+2] = 0; data[i+3] = 255; // all ocean
        }
        window.windPixels = { data, width: W, height: H };
        window.windMeta = { width: W, height: H, uMin: -3, uMax: 3, vMin: -3, vMax: 3 };
    });

    test('65. click on .sim-map over ocean still triggers cloud release', async () => {
        await window.initChoropleth();
        const simMap = document.querySelector('.sim-map');
        const evt = new window.MouseEvent('click', {
            clientX: 50, clientY: 25, bubbles: true, cancelable: true
        });
        simMap.dispatchEvent(evt);
        expect(window.tracerClouds.length).toBe(1);
    });

    test('66. click on a country path bubbles up to .sim-map and releases', async () => {
        await window.initChoropleth();
        const china = document.querySelector('#choropleth path.country[data-country="China"]');
        expect(china).not.toBeNull();
        const evt = new window.MouseEvent('click', {
            clientX: 50, clientY: 25, bubbles: true, cancelable: true
        });
        china.dispatchEvent(evt);
        expect(window.tracerClouds.length).toBe(1);
    });
});
