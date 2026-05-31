// Phase 2 — sidebar wiring + tracer port integration tests.
//
// Loads the real public/index.js and the real control-handler block from
// public/index.html into a jsdom window, with the heavyweight bits
// (WindGL, dat.GUI, XHR, requestAnimationFrame, WebGL context) stubbed.
//
// Run:
//   npm test -- tests/integration/sidebar.test.js

import { describe, test, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

// ----- Test fixtures ---------------------------------------------------------

// Only the DOM that index.js + the control handlers touch. Match attribute
// values to what ships in public/index.html so attribute tests are meaningful.
const SIDEBAR_FIXTURE = `
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
                <div class="ctrl-toggle-row">
                    <span class="ctrl-label">Trajectories</span>
                    <div class="ctrl-toggle off" id="toggle-trajectories" onclick="toggleTrajectories()">
                        <div class="ctrl-toggle-knob"></div>
                    </div>
                </div>
                <div class="ctrl-toggle-row">
                    <span class="ctrl-label">Currents</span>
                    <div class="ctrl-toggle" id="toggle-currents" onclick="toggleCurrents()">
                        <div class="ctrl-toggle-knob"></div>
                    </div>
                </div>
            </div>
        </div>
        <div class="sim-map">
            <canvas id="coastline"></canvas>
            <canvas id="canvas"></canvas>
            <canvas id="land"></canvas>
            <canvas id="tracers"></canvas>
        </div>
    </div>
    <div class="sim-footer">
        <button class="sim-footer-reset" onclick="resetSim()">RESET</button>
    </div>
</div>
`;

// 4x4 land/ocean image. Land mask is channel B. Layout:
//   y=0: L L O O
//   y=1: L L O O
//   y=2: L L O O
//   y=3: L L O O
// So tex.x < 0.5 is land, tex.x >= 0.5 is ocean.
function makeOceanWestLandEast() {
    const W = 4, H = 4;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const isLand = x < 2;
            data[i] = 128;
            data[i + 1] = 128;
            data[i + 2] = isLand ? 200 : 0;
            data[i + 3] = 255;
        }
    }
    return {
        windPixels: { data, width: W, height: H },
        windMeta: { width: W, height: H, uMin: -3, uMax: 3, vMin: -3, vMax: 3 }
    };
}

// ----- Minimal canvas / WebGL stubs ------------------------------------------

const NOOP = () => {};

function makeMock2D() {
    return new Proxy({}, {
        get(_, prop) {
            if (prop === 'createImageData' || prop === 'getImageData') {
                return (a, b, c, d) => {
                    const w = c ?? a;
                    const h = d ?? b;
                    return {
                        data: new Uint8ClampedArray(w * h * 4),
                        width: w,
                        height: h
                    };
                };
            }
            return NOOP;
        },
        set: () => true
    });
}

function makeFakeWindGL() {
    return function () {
        this.diffusion = 0.001;
        this.numParticles = 65000;
        this.fadeOpacity = 0.996;
        this.speedFactor = 0.25;
        this.dropRate = 0.003;
        this.dropRateBump = 0.01;
        this.windData = null;
        this.setWind = function (d) { this.windData = d; };
        this.draw = NOOP;
        this.resize = NOOP;
    };
}

function makeFakeDatGUI() {
    return function () {
        const chain = {
            add: () => chain,
            step: () => chain,
            updateDisplay: () => chain,
            name: () => chain,
            onFinishChange: () => chain,
            domElement: document.createElement('div')
        };
        return chain;
    };
}

// Extracts just the function declarations under "// ---- Control handlers ----"
// up through resetSim from public/index.html's inline <script>.
function extractControlHandlers(html) {
    const start = html.indexOf('// ---- Control handlers ----');
    const end = html.indexOf('</script>', start);
    if (start < 0 || end < 0) {
        throw new Error('Could not locate control handlers in index.html');
    }
    return html.slice(start, end);
}

function readPublic(name) {
    return fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
}

function bootstrap() {
    // Reset state shared across tests
    document.head.innerHTML = '';
    document.body.innerHTML = SIDEBAR_FIXTURE;

    // Stub the WebGL-requiring bits BEFORE index.js evals
    HTMLCanvasElement.prototype.getContext = function (type) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
            return {};
        }
        return makeMock2D();
    };
    // Layout-aware rect so screenToTex returns meaningful coords
    HTMLCanvasElement.prototype.getBoundingClientRect = function () {
        return { left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50, x: 0, y: 0 };
    };

    window.WindGL = makeFakeWindGL();
    window.dat = { GUI: makeFakeDatGUI() };
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = NOOP;
    window.XMLHttpRequest = class XHR {
        constructor() {
            this.onload = null;
            this.responseType = '';
            this.status = 0;
            this.response = null;
        }
        open() {}
        send() { /* deliberately never invoke onload */ }
    };
    window.Image = class FakeImage {
        constructor() {
            this.onload = null;
            this.width = 0;
            this.height = 0;
        }
        set src(_) { /* never trigger onload */ }
    };
    window.devicePixelRatio = 1;

    // Eval the real source files in window scope so var declarations land on window.
    window.eval(readPublic('sim_core.js'));
    window.eval(readPublic('index.js'));

    // Eval the control handlers from index.html (the actual ones we ship).
    const html = readPublic('index.html');
    window.eval(extractControlHandlers(html));

    // Stub windPixels/windMeta — index.js would have set them via buildWindLookup
    // on a successful XHR; ours never fires.
    const ocean = makeOceanWestLandEast();
    window.windPixels = ocean.windPixels;
    window.windMeta = ocean.windMeta;
}

// ----- Tests -----------------------------------------------------------------

describe('Phase 2 — defaults wired through window.params / wind', () => {
    beforeEach(bootstrap);

    test('29. params.cloudLifetimeDays defaults to 30', () => {
        expect(window.params.cloudLifetimeDays).toBe(30);
    });
    test('30. params.particleCount defaults to 50', () => {
        expect(window.params.particleCount).toBe(50);
    });
    test('31. params.showTrajectories defaults to false', () => {
        expect(window.params.showTrajectories).toBe(false);
    });
});

describe('Phase 2 — slider attributes (shipped HTML)', () => {
    beforeEach(bootstrap);

    test('32. #sl-diffusion max=0.002 step=0.0001', () => {
        const el = document.getElementById('sl-diffusion');
        expect(el.getAttribute('max')).toBe('0.002');
        expect(el.getAttribute('step')).toBe('0.0001');
    });
    test('33. #sl-particles min=1 max=50 step=1', () => {
        const el = document.getElementById('sl-particles');
        expect(el.getAttribute('min')).toBe('1');
        expect(el.getAttribute('max')).toBe('50');
        expect(el.getAttribute('step')).toBe('1');
    });
});

describe('Phase 2 — slider input → state', () => {
    beforeEach(bootstrap);

    test('34. setLifetime(90) → params.cloudLifetimeDays === 90', () => {
        window.setLifetime('90');
        expect(window.params.cloudLifetimeDays).toBe(90);
    });
    test('35. setParticles(25) → params.particleCount === 25', () => {
        window.setParticles('25');
        expect(window.params.particleCount).toBe(25);
    });
    test('36. setDiffusion(0.001) → wind.diffusion === 0.001', () => {
        window.setDiffusion('0.001');
        expect(window.wind.diffusion).toBeCloseTo(0.001, 8);
    });
});

describe('Phase 2 — click handler on .sim-map', () => {
    beforeEach(bootstrap);

    function clickAt(clientX, clientY) {
        const simMap = document.querySelector('.sim-map');
        const evt = new window.MouseEvent('click', {
            clientX, clientY, bubbles: true, cancelable: true
        });
        simMap.dispatchEvent(evt);
    }

    test('37. click on ocean → tracerClouds.length === 1', () => {
        // ocean is x >= 0.5 in our fixture; canvas width is stubbed to 100.
        clickAt(75, 25);
        expect(window.tracerClouds.length).toBe(1);
        expect(window.tracerClouds[0].particles.length).toBe(window.params.particleCount);
    });

    test('38. second click immediately → still 1 (single-release lockout)', () => {
        clickAt(75, 25);
        clickAt(80, 30);
        expect(window.tracerClouds.length).toBe(1);
    });

    test('39. after clearing tracerClouds, next click releases again', () => {
        clickAt(75, 25);
        window.tracerClouds.length = 0;
        clickAt(80, 30);
        expect(window.tracerClouds.length).toBe(1);
    });

    test('40. click on land → tracerClouds.length === 0 (no release)', () => {
        clickAt(10, 10);  // x < 0.5 → land
        expect(window.tracerClouds.length).toBe(0);
    });
});

describe('Phase 2 — toggle handlers', () => {
    beforeEach(bootstrap);

    test('41. toggleTrajectories from default OFF → params.showTrajectories === true', () => {
        window.toggleTrajectories();
        expect(window.params.showTrajectories).toBe(true);
    });

    test('42. toggleTrajectories does NOT hide #tracers canvas', () => {
        window.toggleTrajectories();
        const tracers = document.getElementById('tracers');
        // We deliberately removed the display flip — value must not be 'none'.
        expect(tracers.style.display).not.toBe('none');
    });

    test('43. toggleCurrents from default ON → meta.showCurrents === false', () => {
        // Default is ON: meta.showCurrents = true.
        window.toggleCurrents();
        expect(window.meta.showCurrents).toBe(false);
    });
});

describe('Phase 2 — reset', () => {
    beforeEach(bootstrap);

    function clickAt(clientX, clientY) {
        const simMap = document.querySelector('.sim-map');
        const evt = new window.MouseEvent('click', {
            clientX, clientY, bubbles: true, cancelable: true
        });
        simMap.dispatchEvent(evt);
    }

    test('44. Reset clears tracerClouds AND heatBins', () => {
        clickAt(75, 25);
        // Seed a heat bin so we can verify it gets cleared.
        window.heatBins[1234] = 17;
        expect(window.tracerClouds.length).toBe(1);
        expect(window.heatBins[1234]).toBe(17);

        window.resetSim();

        expect(window.tracerClouds.length).toBe(0);
        for (let i = 0; i < window.heatBins.length; i++) {
            if (window.heatBins[i] !== 0) {
                throw new Error('heatBins[' + i + '] = ' + window.heatBins[i] + ' (expected 0)');
            }
        }
    });
});
