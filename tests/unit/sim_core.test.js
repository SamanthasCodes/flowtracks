// Phase 1 — pure-math unit tests for public/sim_core.js
//
// Run from repo root:
//   npm test -- tests/unit
//
// Each `test(...)` line is one numbered case from plans/tdd_port_map_to_main_shell.md.

import { describe, test, expect, beforeAll } from 'vitest';

let SimCore;

beforeAll(async () => {
    await import('../../public/sim_core.js');
    SimCore = globalThis.SimCore;
});

describe('Phase 1 — sim_core: lifetime conversion', () => {
    test('1. cloudLifetimeToFrames(30) === 648', () => {
        expect(SimCore.cloudLifetimeToFrames(30)).toBe(648);
    });
    test('2. cloudLifetimeToFrames(1) === 21', () => {
        expect(SimCore.cloudLifetimeToFrames(1)).toBe(21);
    });
    test('3. cloudLifetimeToFrames(365) === 7884', () => {
        expect(SimCore.cloudLifetimeToFrames(365)).toBe(7884);
    });
    test('4. cloudLifetimeToFrames(90) === 1944', () => {
        expect(SimCore.cloudLifetimeToFrames(90)).toBe(1944);
    });
});

describe('Phase 1 — sim_core: advectStep', () => {
    const rngZero = () => 0.5; // (0.5 - 0.5)*2*diff === 0 — no diffusion contribution

    test('5. zero current, zero diffusion → output equals input', () => {
        const out = SimCore.advectStep(
            { x: 0.5, y: 0.5 },
            { u: 0, v: 0 },
            { speedFactor: 1, diffusion: 0, rng: rngZero }
        );
        expect(out.x).toBeCloseTo(0.5, 12);
        expect(out.y).toBeCloseTo(0.5, 12);
    });

    test('6. u=1, speedFactor=1, equator → dx ≈ 1e-4, dy ≈ 0', () => {
        const out = SimCore.advectStep(
            { x: 0.5, y: 0.5 },
            { u: 1, v: 0 },
            { speedFactor: 1, diffusion: 0, rng: rngZero }
        );
        expect(out.x - 0.5).toBeCloseTo(1e-4, 8);
        expect(out.y - 0.5).toBeCloseTo(0, 12);
    });

    test('7. u=1, speedFactor=1, lat=60° → dx ≈ 2e-4 (cos-distortion doubles)', () => {
        // lat = 60° → pt.y = (60 + 90) / 180 = 0.8333...
        const out = SimCore.advectStep(
            { x: 0.5, y: (60 + 90) / 180 },
            { u: 1, v: 0 },
            { speedFactor: 1, diffusion: 0, rng: rngZero }
        );
        expect(out.x - 0.5).toBeCloseTo(2e-4, 7);
    });

    test('8. u=v=0, diffusion=0.002, rng=0.75 → dx=+0.001, dy=+0.001', () => {
        const out = SimCore.advectStep(
            { x: 0.5, y: 0.5 },
            { u: 0, v: 0 },
            { speedFactor: 1, diffusion: 0.002, rng: () => 0.75 }
        );
        expect(out.x - 0.5).toBeCloseTo(0.001, 10);
        expect(out.y - 0.5).toBeCloseTo(0.001, 10);
    });

    test('9. x near 1.0 with positive u wraps to ~0', () => {
        const out = SimCore.advectStep(
            { x: 0.9999, y: 0.5 },
            { u: 10, v: 0 },
            { speedFactor: 1, diffusion: 0, rng: rngZero }
        );
        // dx = 10 * 1e-4 = 0.001 → 1.0009 % 1 = 0.0009
        expect(out.x).toBeLessThan(0.01);
        expect(out.x).toBeGreaterThanOrEqual(0);
    });

    test('10. x near 0 with negative u wraps to ~1', () => {
        const out = SimCore.advectStep(
            { x: 0.0001, y: 0.5 },
            { u: -10, v: 0 },
            { speedFactor: 1, diffusion: 0, rng: rngZero }
        );
        // dx = -0.001 → -0.0009 → +1 = 0.9991
        expect(out.x).toBeGreaterThan(0.99);
        expect(out.x).toBeLessThan(1);
    });
});

describe('Phase 1 — sim_core: spreadMetric', () => {
    test('11. single point returns 0', () => {
        expect(SimCore.spreadMetric([{ x: 0.5, y: 0.5 }])).toBe(0);
    });

    test('12. two co-located points return 0', () => {
        const parts = [
            { x: 0.5, y: 0.5 },
            { x: 0.5, y: 0.5 }
        ];
        expect(SimCore.spreadMetric(parts)).toBeCloseTo(0, 12);
    });

    test('13. two points 0.01 apart return ~0.005', () => {
        const parts = [
            { x: 0.495, y: 0.5 },
            { x: 0.505, y: 0.5 }
        ];
        expect(SimCore.spreadMetric(parts)).toBeCloseTo(0.005, 8);
    });

    test('14. two points straddling antimeridian return ~0.01 (NOT ~0.49)', () => {
        const parts = [
            { x: 0.01, y: 0.5 },
            { x: 0.99, y: 0.5 }
        ];
        const m = SimCore.spreadMetric(parts);
        expect(m).toBeCloseTo(0.01, 8);
        // Sanity: catastrophically wrong implementations return ~0.49.
        expect(m).toBeLessThan(0.05);
    });
});

describe('Phase 1 — sim_core: resolveCountryName', () => {
    test('15. "United States" → "United States of America"', () => {
        expect(SimCore.resolveCountryName('United States', SimCore.NAME_MAP))
            .toBe('United States of America');
    });
    test('16. "Algeria8" → "Algeria"', () => {
        expect(SimCore.resolveCountryName('Algeria8', SimCore.NAME_MAP))
            .toBe('Algeria');
    });
    test('17. "Burma/Myanmar" → "Myanmar"', () => {
        expect(SimCore.resolveCountryName('Burma/Myanmar', SimCore.NAME_MAP))
            .toBe('Myanmar');
    });
    test('18. unknown name passes through unchanged', () => {
        expect(SimCore.resolveCountryName('Some Unknown Country', SimCore.NAME_MAP))
            .toBe('Some Unknown Country');
    });
});

describe('Phase 1 — sim_core: logBinColor', () => {
    test('19. logBinColor(0) === "#ffffcc" (bin 0)', () => {
        expect(SimCore.logBinColor(0, SimCore.BIN_THRESHOLDS, SimCore.BIN_COLORS))
            .toBe('#ffffcc');
    });
    test('20. logBinColor(2_224_561) === "#b10026" (Indonesia top bin)', () => {
        expect(SimCore.logBinColor(2224561, SimCore.BIN_THRESHOLDS, SimCore.BIN_COLORS))
            .toBe('#b10026');
    });
    test('21. logBinColor(5_344_433) === "#b10026" (China clamps to top)', () => {
        expect(SimCore.logBinColor(5344433, SimCore.BIN_THRESHOLDS, SimCore.BIN_COLORS))
            .toBe('#b10026');
    });
    test('22. logBinColor(50) === "#fed976" (10–100 bin)', () => {
        expect(SimCore.logBinColor(50, SimCore.BIN_THRESHOLDS, SimCore.BIN_COLORS))
            .toBe('#fed976');
    });
});

describe('Phase 1 — sim_core: heatmapColor', () => {
    test('23. heatmapColor(0) === [0, 0, 255] (blue)', () => {
        expect(SimCore.heatmapColor(0)).toEqual([0, 0, 255]);
    });
    test('24. heatmapColor(1) === [255, 0, 0] (red)', () => {
        expect(SimCore.heatmapColor(1)).toEqual([255, 0, 0]);
    });
    test('25. heatmapColor(0.5) in yellow region: r=255, g=255, b∈{0,1}', () => {
        const [r, g, b] = SimCore.heatmapColor(0.5);
        expect(r).toBe(255);
        expect(g).toBe(255);
        expect(b).toBeLessThanOrEqual(1);
    });
});
