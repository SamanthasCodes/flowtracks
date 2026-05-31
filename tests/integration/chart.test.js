// Phase 5 — chart DOM + sidebar legend palette integration tests.
//
// Loads sim_core.js + index.js into a jsdom window, replaces chartCtx with
// a recording proxy, then drives drawChart() to inspect axis labels, curve
// strokes, and the empty-state placeholder.
//
// Run:
//   npm test -- tests/integration/chart.test.js

import { describe, test, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

// ----- Fixture (chart host + sidebar legend, plus minimum index.js needs) ----

const CHART_FIXTURE = `
<div class="page">
    <div class="sim-body">
        <div class="sim-sidebar">
            <div class="sidebar-legend">
                <div class="legend-bar">
                    <div style="flex:1;background:rgb(0, 0, 255)"></div>
                    <div style="flex:1;background:rgb(0, 170, 255)"></div>
                    <div style="flex:1;background:rgb(85, 255, 170)"></div>
                    <div style="flex:1;background:rgb(255, 255, 0)"></div>
                    <div style="flex:1;background:rgb(255, 85, 0)"></div>
                    <div style="flex:1;background:rgb(255, 0, 0)"></div>
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
</div>
`;

// ----- Helpers ---------------------------------------------------------------

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

function bootstrap() {
    document.head.innerHTML = '';
    document.body.innerHTML = CHART_FIXTURE;

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
    window.dat = { GUI: function () {
        const f = {}; ['add','step','name','onFinishChange','updateDisplay']
            .forEach(m => f[m] = () => f);
        f.domElement = document.createElement('div');
        return f;
    } };
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = NOOP;
    window.XMLHttpRequest = class { constructor(){this.onload=null;} open(){} send(){} };
    window.Image = class { constructor(){this.onload=null;} set src(_){} };
    window.devicePixelRatio = 1;

    // No d3 needed for chart tests, but choropleth render will be skipped
    // gracefully if d3 is undefined (initChoropleth never fires because XHR
    // is stubbed and image.onload never runs).

    window.eval(readPublic('sim_core.js'));
    window.eval(readPublic('index.js'));

    // Replace chartCtx with a recording proxy; chartCanvas dims must be > 0.
    window.chartCanvas.width = 248;
    window.chartCanvas.height = 120;
    const rec = makeRecordingCtx();
    window.chartCtx = rec.ctx;
    window._chartCalls = rec.calls;
}

function fillTextCalls(calls) {
    return calls.filter(c => c.method === 'fillText' && typeof c.args[0] === 'string');
}

// ----- Tests -----------------------------------------------------------------

describe('Phase 5 — drawChart placeholder + axes', () => {
    beforeEach(bootstrap);

    test("70. empty chart shows 'Click the ocean to release particles'", () => {
        window.chartClouds.length = 0;
        window.drawChart();
        const matches = fillTextCalls(window._chartCalls)
            .filter(c => c.args[0] === 'Click the ocean to release particles');
        expect(matches.length).toBe(1);
    });

    test("71. one cloud → strokeStyle set to that cloud's color ('#c8f03c')", () => {
        window.chartClouds.length = 0;
        window.chartClouds.push({ spreadHistory: [0, 0.01, 0.02], color: '#c8f03c' });
        window.drawChart();
        const assigns = window._chartCalls.filter(c =>
            c.method === 'set:strokeStyle' && c.args[0] === '#c8f03c'
        );
        expect(assigns.length).toBeGreaterThan(0);
        // And actually stroked the curve
        const strokeOps = window._chartCalls.filter(c => c.method === 'stroke');
        expect(strokeOps.length).toBeGreaterThan(0);
    });

    test("72. y-axis label contains 'km' (regression: not 'LONGITUDE' or degrees)", () => {
        window.chartClouds.length = 0;
        window.chartClouds.push({ spreadHistory: [0, 0.01], color: '#c8f03c' });
        window.drawChart();
        const texts = fillTextCalls(window._chartCalls).map(c => c.args[0]).join(' | ');
        expect(texts).toMatch(/km/);
        expect(texts).not.toMatch(/LONGITUDE|degrees|°/);
    });

    test("73. x-axis label contains 'days' (regression: not 'STEPS')", () => {
        window.chartClouds.length = 0;
        window.chartClouds.push({ spreadHistory: [0, 0.01], color: '#c8f03c' });
        window.drawChart();
        const texts = fillTextCalls(window._chartCalls).map(c => c.args[0]).join(' | ');
        expect(texts).toMatch(/days/);
        expect(texts).not.toMatch(/STEPS/);
    });
});

describe('Phase 5 — sidebar legend palette', () => {
    beforeEach(bootstrap);

    test('74. first .legend-bar swatch background === heatmapColor(0) = rgb(0, 0, 255)', () => {
        const first = document.querySelector('.legend-bar > div:first-child');
        expect(first).not.toBeNull();
        // jsdom's getComputedStyle normalizes inline 'rgb(0, 0, 255)' to the same string.
        const bg = getComputedStyle(first).backgroundColor;
        expect(bg.replace(/\s+/g, '')).toBe('rgb(0,0,255)');

        // Sanity-check: this is exactly what SimCore.heatmapColor(0) reports.
        const [r, g, b] = globalThis.SimCore.heatmapColor(0);
        expect([r, g, b]).toEqual([0, 0, 255]);
    });
});
