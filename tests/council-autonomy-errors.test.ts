import { describe, expect, test } from "bun:test";
import { CouncilAutonomyError, classifyCouncilFailure } from "../src/council/autonomy-errors";

describe("Council autonomy errors", () => {
  test("preserves structured failure codes", () => {
    expect(classifyCouncilFailure(new CouncilAutonomyError("CHATGPT_LIMITED", "limit", false))).toEqual({
      code: "CHATGPT_LIMITED",
      retryableBeforeSubmit: false,
    });
  });

  test("maps legacy capacity evidence conservatively", () => {
    expect(classifyCouncilFailure(new Error("all browser surfaces are busy"))).toEqual({
      code: "CAPACITY_BUSY",
      retryableBeforeSubmit: true,
    });
  });

  test("does not treat an unknown error as retryable", () => {
    expect(classifyCouncilFailure(new Error("unexpected"))).toEqual({
      code: "UNKNOWN",
      retryableBeforeSubmit: false,
    });
  });
});
