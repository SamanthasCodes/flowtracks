// Phase 4 — choropleth pure-helper unit tests.
//
// All exercised helpers live in public/sim_core.js (parseNum, formatFull,
// NAME_MAP, BIN_THRESHOLDS, BIN_COLORS). The full d3/topojson integration
// is covered separately by tests/integration/choropleth.test.js.

import { describe, test, expect, beforeAll } from 'vitest';

let SimCore;

beforeAll(async () => {
    await import('../../public/sim_core.js');
    SimCore = globalThis.SimCore;
});

describe('Phase 4 — parseNum (juliosbranch behavior)', () => {
    test("54. parseNum('1,234') === 1234", () => {
        expect(SimCore.parseNum('1,234')).toBe(1234);
    });
    test("55. parseNum(' 12,345 ') === 12345 (trims + strips commas)", () => {
        expect(SimCore.parseNum(' 12,345 ')).toBe(12345);
    });
    test("56. parseNum('-') === 0 (NaN fallback)", () => {
        // juliosbranch: `parseFloat('-') || 0` → 0 because NaN is falsy.
        expect(SimCore.parseNum('-')).toBe(0);
    });
});

describe('Phase 4 — formatFull (juliosbranch behavior)', () => {
    test("57. formatFull(1_234_567) === '1,234,567'", () => {
        // toLocaleString('en-US', { maximumFractionDigits: 0 }) on 1234567.
        expect(SimCore.formatFull(1234567)).toBe('1,234,567');
    });
});

describe('Phase 4 — nameMap fallbacks', () => {
    test("58. nameMap['Vietnam8'] === 'Vietnam'", () => {
        expect(SimCore.NAME_MAP['Vietnam8']).toBe('Vietnam');
    });
    test("59. nameMap['United States'] === 'United States of America'", () => {
        expect(SimCore.NAME_MAP['United States']).toBe('United States of America');
    });
});
