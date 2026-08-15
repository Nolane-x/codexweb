import { describe, expect, test } from "bun:test";
import { rankCouncilCandidates } from "../src/council/candidate-hints";

describe("rankCouncilCandidates", () => {
  const task = { id: "task1", title: "Review authentication race tests", description: "Inspect auth concurrency failures", status: "review" as const };
  test("prefers healthy low-load role-overlap candidates and excludes open breakers", () => {
    const ranked = rankCouncilCandidates({
      task,
      agents: [
        { id: "bob", name: "Bob", role: "Backend coder", mandate: "Implement authentication", runtimeStatus: "sleeping", openTasks: 3, health: "healthy" },
        { id: "rhea", name: "Rhea", role: "Security reviewer", mandate: "Review authentication and concurrency", runtimeStatus: "sleeping", openTasks: 0, health: "healthy" },
        { id: "limit", name: "Limit", role: "Security reviewer", mandate: "Review auth", runtimeStatus: "sleeping", openTasks: 0, health: "limited" },
      ],
      completedTaskTexts: { rhea: ["Reviewed login authentication race conditions"] },
    });
    expect(ranked[0]?.agentId).toBe("rhea");
    expect(ranked.some(value => value.agentId === "limit")).toBe(false);
  });

  test("penalizes active overload without making ranking nondeterministic", () => {
    const input = {
      task: { ...task, status: "in_progress" as const },
      agents: [
        { id: "a", name: "A", role: "Backend", mandate: "auth", runtimeStatus: "active" as const, openTasks: 4, health: "healthy" as const },
        { id: "b", name: "B", role: "Backend", mandate: "auth", runtimeStatus: "sleeping" as const, openTasks: 0, health: "sleeping" as const },
      ],
    };
    expect(rankCouncilCandidates(input)).toEqual(rankCouncilCandidates(input));
    expect(rankCouncilCandidates(input)[0]?.agentId).toBe("b");
  });
});
