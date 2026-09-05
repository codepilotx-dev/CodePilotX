import { describe, expect, test } from "bun:test";

import { normalizeLiveResizeSize } from "../src/features/layout/useLiveResizeValue.js";

describe("live resize value", () => {
  test("deduplicates preview sizes at the current physical pixel boundary", () => {
    expect(normalizeLiveResizeSize(320.24, 1.75)).toBe(
      normalizeLiveResizeSize(320.28, 1.75),
    );
    expect(normalizeLiveResizeSize(320.7, 1.75)).not.toBe(
      normalizeLiveResizeSize(320.28, 1.75),
    );
  });

  test("normalizes fractional CSS pixels without accepting an invalid pixel ratio", () => {
    expect(normalizeLiveResizeSize(600.4, Number.NaN)).toBe(600);
    expect(normalizeLiveResizeSize(600.4, 0)).toBe(600);
    expect(normalizeLiveResizeSize(600.4, 2)).toBe(600.5);
  });
});
