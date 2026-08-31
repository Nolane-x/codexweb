import { describe, expect, test } from "bun:test";
import { classifyCouncilConnectorObservation } from "../src/council/chatgpt-connector-policy";

describe("Council ChatGPT connector policy", () => {
  test("treats one exact selected marker as selected", () => {
    expect(classifyCouncilConnectorObservation({ selectedExactCount: 1, exactMenuRowCount: 0 })).toBe("selected");
  });

  test("treats one exact menu row as selectable", () => {
    expect(classifyCouncilConnectorObservation({ selectedExactCount: 0, exactMenuRowCount: 1 })).toBe("selectable");
  });

  test("treats exact absence as optional-unavailable", () => {
    expect(classifyCouncilConnectorObservation({ selectedExactCount: 0, exactMenuRowCount: 0 })).toBe("unavailable");
  });

  test("refuses duplicate exact evidence as ambiguous", () => {
    expect(classifyCouncilConnectorObservation({ selectedExactCount: 2, exactMenuRowCount: 0 })).toBe("ambiguous");
    expect(classifyCouncilConnectorObservation({ selectedExactCount: 0, exactMenuRowCount: 2 })).toBe("ambiguous");
  });
});
