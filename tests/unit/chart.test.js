// Phase 5 — chart unit-conversion sanity tests (pure math, no DOM).

import { describe, test, expect, beforeAll } from 'vitest';

let SimCore;

beforeAll(async () => {
    await import('../../public/sim_core.js');
    SimCore = globalThis.SimCore;
});

describe('Phase 5 — chart conversions', () => {
    test("67. spread 0.05 (tex) → '1000' km", () => {
        expect((0.05 * 20000).toFixed(0)).toBe('1000');
    });

    test("68. 648 frames at 4000 s/frame → '30' days", () => {
        expect((648 * SimCore.SECONDS_PER_FRAME / 86400).toFixed(0)).toBe('30');
    });

    test("69. 7884 frames → '365' days (one cloud lifetime year)", () => {
        expect((7884 * SimCore.SECONDS_PER_FRAME / 86400).toFixed(0)).toBe('365');
    });
});
