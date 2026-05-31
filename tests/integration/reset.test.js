// Phase 6 — reset + cleanup regression tests.
//
// 75–78: resetSim clears tracerClouds, chartClouds, heatBins, AND fires
//        drawChart so the empty-state placeholder appears immediately.
// 79:    background.jpeg / background1.jpeg from juliosbranch must not have
//        snuck into the merge.
// 80:    package-lock.json must be committed (regression for the npm harness).
//
// Run:
//   npm test -- tests/integration/reset.test.js

import { describe, test, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

// ---- Filesystem regression checks (no DOM bootstrap needed) ----------------

describe('Phase 6 — repo cleanup checks', () => {
    test("79a. public/background.jpeg does NOT exist", () => {
        expect(fs.existsSync(path.join(PUBLIC_DIR, 'background.jpeg'))).toBe(false);
    });
    test("79b. public/background1.jpeg does NOT exist", () => {
        expect(fs.existsSync(path.join(PUBLIC_DIR, 'background1.jpeg'))).toBe(false);
    });
    test("80. package-lock.json exists at repo root", () => {
        expect(fs.existsSync(path.join(REPO_ROOT, 'package-lock.json'))).toBe(true);
    });
});

// ---- Reset behavior --------------------------------------------------------

const FIXTURE = `
<div class="page">
    <div class="sim-body">
        <div class="sim-sidebar">
            <div class="sidebar-controls">
                <div class="ctrl-item">
                    <span class="ctrl-value" id="val-diffusion">0.001</span>
                    <input type="range" class="ctrl-slider" id="sl-diffusion"
                           min="0" max="0.002" step="0.0001" value="0.001"
                           oninput="setDiffusion(this.value)">
                </div>
                <div class="ctrl-item">
                    <span class="ctrl-value" id="val-lifetime">30</span>
                    <input type="range" class="ctrl-slider" id="sl-lifetime"
                           min="1" max="365" step="1" value="30"
                           oninput="setLifetime(this.value)">
                </div>
                <div class="ctrl-item">
                    <span class="ctrl-value" id="val-particles">50</span>
                    <input type="range" class="ctrl-slider" id="sl-particles"
                           min="1" max="50" step="1" value="50"
                           oninput="setParticles(this.value)">
                </div>
            </div>
            <div class="sidebar-chart">
                <div id="chartHost" class="sidebar-chart-host"></div>
            </div>
        </div>
        <div class="sim-map-wrapper">
            <div class="sim-map">
                <canvas id="coastline"></canvas>
                <canvas id="canvas"></canvas>
                <canvas id="land"></canvas>
                <svg id="choropleth"></svg>
                <div id="legend"></div>
                <canvas id="tracers"></canvas>
            </div>
        </div>
    </div>
    <div class="sim-footer">
        <button class="sim-footer-reset" onclick="resetSim()">RESET</button>
    </div>
</div>
`;

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

function makeRecordingCtx() {
    const calls = [];
    const ctx = new Proxy({}, {
        get(_, prop) {
            return (...args) => { calls.push({ method: prop, args }); };
        },
        set(_, prop, value) {
            calls.push({ method: 'set:' + String(prop), args: [value] });
            return true;
        }
    });
    return { ctx, calls };
}

function readPublic(name) {
    return fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
}

function extractControlHandlers(html) {
    const start = html.indexOf('// ---- Control handlers ----');
    const end = html.indexOf('</script>', start);
    return html.slice(start, end);
}

// Helper: shape used in the existing sidebar.test.js — 4×4 land/ocean image
// with the right half marked as ocean (so clicks at clientX > 50 release).
function makeOceanWestHalfLand() {
    const W = 4, H = 4;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const isLand = x < 2;
            data[i] = 128; data[i+1] = 128;
            data[i+2] = isLand ? 200 : 0;
            data[i+3] = 255;
        }
    }
    return {
        windPixels: { data, width: W, height: H },
        windMeta: { width: W, height: H, uMin: -3, uMax: 3, vMin: -3, vMax: 3 }
    };
}

function bootstrap() {
    document.head.innerHTML = '';
    document.body.innerHTML = FIXTURE;

    HTMLCanvasElement.prototype.getContext = function (type) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return {};
        return makeMock2D();
    };
    HTMLCanvasElement.prototype.getBoundingClientRect = function () {
        return { left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50, x: 0, y: 0 };
    };

    window.WindGL = function () {
        this.diffusion = 0.001; this.numParticles = 65000;
        this.speedFactor = 0.25; this.windData = null;
        this.setWind = NOOP; this.draw = NOOP; this.resize = NOOP;
    };
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = NOOP;
    window.XMLHttpRequest = class { constructor(){this.onload=null;} open(){} send(){} };
    window.Image = class { constructor(){this.onload=null;} set src(_){} };
    window.devicePixelRatio = 1;

    window.eval(readPublic('sim_core.js'));
    window.eval(readPublic('index.js'));
    window.eval(extractControlHandlers(readPublic('index.html')));

    const ocean = makeOceanWestHalfLand();
    window.windPixels = ocean.windPixels;
    window.windMeta = ocean.windMeta;

    // Swap chartCtx for a recorder so test 78 can introspect placeholder text.
    window.chartCanvas.width = 248;
    window.chartCanvas.height = 120;
    const rec = makeRecordingCtx();
    window.chartCtx = rec.ctx;
    window._chartCalls = rec.calls;
}

function clickOnSimMapAt(clientX, clientY) {
    const simMap = document.querySelector('.sim-map');
    const evt = new window.MouseEvent('click', {
        clientX, clientY, bubbles: true, cancelable: true
    });
    simMap.dispatchEvent(evt);
}

describe('Phase 6 — resetSim', () => {
    beforeEach(bootstrap);

    test('75. cloud release populates chartClouds.length === 1', () => {
        clickOnSimMapAt(75, 25);   // x > 50 in our 100px wide canvas → ocean half
        expect(window.chartClouds.length).toBe(1);
    });

    test('76. resetSim clears tracerClouds AND chartClouds', () => {
        clickOnSimMapAt(75, 25);
        // Also seed a heat bin so we can verify it on test 77.
        window.heatBins[42] = 99;
        window.resetSim();
        expect(window.tracerClouds.length).toBe(0);
        expect(window.chartClouds.length).toBe(0);
    });

    test('77. resetSim zeroes every heatBins cell', () => {
        clickOnSimMapAt(75, 25);
        for (let i = 0; i < 5; i++) window.heatBins[i * 1000] = 7 + i;
        window.resetSim();
        let nonZero = 0;
        for (let i = 0; i < window.heatBins.length; i++) {
            if (window.heatBins[i] !== 0) nonZero++;
        }
        expect(nonZero).toBe(0);
    });

    test("78. resetSim immediately re-draws the empty-state placeholder", () => {
        clickOnSimMapAt(75, 25);
        // Empty the recorder so we only inspect the post-reset drawChart call.
        window._chartCalls.length = 0;

        window.resetSim();

        const placeholder = window._chartCalls.filter(c =>
            c.method === 'fillText' && c.args[0] === 'Click the ocean to release particles'
        );
        expect(placeholder.length).toBe(1);
    });
});
