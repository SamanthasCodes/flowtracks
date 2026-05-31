// Phase 3 — currents overlay unit tests.
//
// We load index.js into a fake window scope and pull `currentPaths`,
// `drawSmoothPath`, `drawArrow`, `drawCurrents` off of it. The tests then
// invoke those with a recording 2D context that captures every method call
// and property assignment.
//
// Run:
//   npm test -- tests/unit/currents.test.js

import { describe, test, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../../public');

let currentPaths;
let drawSmoothPath;
let drawArrow;
let drawCurrents;

// Build a minimal global scope that mirrors what a browser would expose to
// index.js, with WebGL / dat.GUI / XHR / DOM lookups stubbed. We only need
// the four exports above, but the rest of index.js runs unconditionally on
// load so we have to satisfy its top-level side-effects.
beforeAll(() => {
    const sandbox = makeBrowserSandbox();
    const ctx = vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'sim_core.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'index.js'), 'utf8'), ctx);
    currentPaths   = ctx.currentPaths;
    drawSmoothPath = ctx.drawSmoothPath;
    drawArrow      = ctx.drawArrow;
    drawCurrents   = ctx.drawCurrents;
});

// ----- Sandbox helpers -------------------------------------------------------

function makeFakeElement() {
    const el = {
        clientWidth: 100,
        clientHeight: 50,
        width: 100,
        height: 50,
        style: {},
        classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
        appendChild: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        querySelector: () => null,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50 }),
        getContext: (type) => (type && type.indexOf('webgl') >= 0 ? {} : makeMock2D())
    };
    return el;
}

function makeMock2D() {
    return new Proxy({}, {
        get(_, prop) {
            if (prop === 'createImageData' || prop === 'getImageData') {
                return (a, b, c, d) => {
                    const w = c ?? a, h = d ?? b;
                    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
                };
            }
            return () => {};
        },
        set: () => true
    });
}

function makeFakeDocument() {
    return {
        getElementById: () => makeFakeElement(),
        querySelector: () => makeFakeElement(),
        createElement: () => makeFakeElement(),
        body: makeFakeElement(),
        head: makeFakeElement(),
        addEventListener: () => {},
        documentElement: makeFakeElement(),
        fonts: { load: () => Promise.resolve() }
    };
}

function makeBrowserSandbox() {
    const sandbox = {
        WindGL: function () {
            this.diffusion = 0.001; this.numParticles = 65000;
            this.speedFactor = 0.25; this.windData = null;
            this.setWind = function () {}; this.draw = function () {}; this.resize = function () {};
        },
        dat: {
            GUI: function () {
                const f = {};
                ['add', 'step', 'name', 'onFinishChange', 'updateDisplay']
                    .forEach(m => f[m] = () => f);
                f.domElement = makeFakeElement();
                return f;
            }
        },
        XMLHttpRequest: class { constructor() { this.onload = null; } open() {} send() {} },
        Image: class { constructor() { this.onload = null; } set src(_) {} },
        requestAnimationFrame: () => 0,
        cancelAnimationFrame: () => {},
        devicePixelRatio: 1,
        Math, Date, JSON, console, Error, Promise,
        Uint8Array, Uint8ClampedArray, Float32Array, Int32Array,
        setTimeout, clearTimeout, setInterval, clearInterval,
        document: makeFakeDocument()
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    return sandbox;
}

// ----- Recording 2D context --------------------------------------------------

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

function count(calls, method) {
    return calls.filter(c => c.method === method).length;
}

// ----- Tests -----------------------------------------------------------------

describe('Phase 3 — currentPaths array shape', () => {
    test('45. currentPaths.length >= 10', () => {
        expect(currentPaths.length).toBeGreaterThanOrEqual(10);
    });

    test('46. each entry has name:string, color:string, path:[[lon,lat]...]', () => {
        for (const c of currentPaths) {
            expect(typeof c.name).toBe('string');
            expect(typeof c.color).toBe('string');
            expect(Array.isArray(c.path)).toBe(true);
            expect(c.path.length).toBeGreaterThan(0);
            for (const pt of c.path) {
                expect(Array.isArray(pt)).toBe(true);
                expect(pt.length).toBe(2);
                expect(typeof pt[0]).toBe('number');
                expect(typeof pt[1]).toBe('number');
            }
        }
    });
});

describe('Phase 3 — drawSmoothPath', () => {
    test('47. 2 points → 1 moveTo + ≥1 quadraticCurveTo or lineTo', () => {
        const { ctx, calls } = makeRecordingCtx();
        drawSmoothPath(ctx, [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
        expect(count(calls, 'moveTo')).toBe(1);
        const curveOrLine = count(calls, 'quadraticCurveTo') + count(calls, 'lineTo');
        expect(curveOrLine).toBeGreaterThanOrEqual(1);
    });

    test('48. 5 points → ≥4 quadraticCurveTo calls', () => {
        const { ctx, calls } = makeRecordingCtx();
        drawSmoothPath(ctx, [
            { x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 8 },
            { x: 30, y: 12 }, { x: 40, y: 18 }
        ]);
        expect(count(calls, 'quadraticCurveTo')).toBeGreaterThanOrEqual(4);
    });
});

describe('Phase 3 — drawArrow', () => {
    test('49. translate(100, 50), rotate(0), fill() each called once', () => {
        const { ctx, calls } = makeRecordingCtx();
        drawArrow(ctx, 100, 50, 0, 8);
        const translateCalls = calls.filter(c => c.method === 'translate');
        const rotateCalls    = calls.filter(c => c.method === 'rotate');
        expect(translateCalls).toHaveLength(1);
        expect(translateCalls[0].args).toEqual([100, 50]);
        expect(rotateCalls).toHaveLength(1);
        expect(rotateCalls[0].args).toEqual([0]);
        expect(count(calls, 'fill')).toBe(1);
    });
});

describe('Phase 3 — drawCurrents toggle gating', () => {
    const ONE_CURRENT = [{
        name: 'TestStream', color: '#abcdef',
        path: [[10, 10], [20, 10], [30, 10], [40, 10]]
    }];

    test('50. showCurrents=true draws the label (strokeText called once)', () => {
        const { ctx, calls } = makeRecordingCtx();
        drawCurrents(ctx, ONE_CURRENT, { showCurrents: true, cw: 1000, ch: 500 });
        expect(count(calls, 'strokeText')).toBe(1);
    });

    test('51. showCurrents=false → zero strokeText calls', () => {
        const { ctx, calls } = makeRecordingCtx();
        drawCurrents(ctx, ONE_CURRENT, { showCurrents: false, cw: 1000, ch: 500 });
        expect(count(calls, 'strokeText')).toBe(0);
    });

    test('52. path with >180° lon jump splits into ≥2 segments (≥2 beginPath)', () => {
        // Two consecutive points 190° apart in raw longitude force the
        // antimeridian split: |tx[1] - tx[0]| > cw * 0.5.
        const split = [{
            name: 'SplitTest', color: '#abcdef',
            path: [[10, 0], [200, 0], [210, 0]]  // 10°, 200° in [0,360] → diff 190° > 180°
        }];
        const { ctx, calls } = makeRecordingCtx();
        drawCurrents(ctx, split, { showCurrents: true, cw: 1000, ch: 500 });
        // Each segment fires its own drawSmoothPath → its own beginPath.
        expect(count(calls, 'beginPath')).toBeGreaterThanOrEqual(2);
    });

    test('53. cw === 0 → no method calls (size guard)', () => {
        const { ctx, calls } = makeRecordingCtx();
        drawCurrents(ctx, ONE_CURRENT, { showCurrents: true, cw: 0, ch: 500 });
        expect(calls.length).toBe(0);
    });
});
