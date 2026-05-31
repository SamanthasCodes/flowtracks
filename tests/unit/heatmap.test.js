// Phase 1 — heatmap accumulator unit tests.

import { describe, test, expect, beforeAll } from 'vitest';

let SimCore;

beforeAll(async () => {
    await import('../../public/sim_core.js');
    SimCore = globalThis.SimCore;
});

describe('Phase 1 — accumulateHeat', () => {
    test('26. single particle at (0.5, 0.5) increments bin (180, 90)', () => {
        const W = 360, H = 180;
        const bins = new Float32Array(W * H);
        SimCore.accumulateHeat(bins, W, H, 0.5, 0.5);
        expect(bins[90 * W + 180]).toBe(1);
    });

    test('27. 100 calls at same position → that bin === 100, all others stay 0', () => {
        const W = 360, H = 180;
        const bins = new Float32Array(W * H);
        for (let i = 0; i < 100; i++) {
            SimCore.accumulateHeat(bins, W, H, 0.5, 0.5);
        }
        const target = 90 * W + 180;
        expect(bins[target]).toBe(100);
        let nonZeroBins = 0;
        for (let i = 0; i < bins.length; i++) {
            if (bins[i] !== 0) nonZeroBins++;
        }
        expect(nonZeroBins).toBe(1);
    });

    test('28. no decay — two calls produce bin value 2', () => {
        const W = 360, H = 180;
        const bins = new Float32Array(W * H);
        SimCore.accumulateHeat(bins, W, H, 0.25, 0.25);
        SimCore.accumulateHeat(bins, W, H, 0.25, 0.25);
        // 0.25 * 360 = 90, 0.25 * 180 = 45
        expect(bins[45 * W + 90]).toBe(2);
    });
});
