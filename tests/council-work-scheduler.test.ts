import { describe, expect, test } from "bun:test";
import { CouncilWorkScheduler } from "../src/council/work-scheduler";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("CouncilWorkScheduler", () => {
  test("runs browser work strictly sequentially", async () => {
    const scheduler = new CouncilWorkScheduler();
    const events: string[] = [];
    const first = scheduler.enqueue("first", async () => {
      events.push("first:start");
      await wait(20);
      events.push("first:end");
      return 1;
    });
    const second = scheduler.enqueue("second", async () => {
      events.push("second:start");
      events.push("second:end");
      return 2;
    });
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
    expect(scheduler.snapshot().completed).toBe(2);
  });

  test("retries only errors explicitly classified as retryable", async () => {
    const scheduler = new CouncilWorkScheduler();
    let attempts = 0;
    const result = await scheduler.enqueue("retry", async attempt => {
      attempts = attempt;
      if (attempt < 3) throw new Error("capacity busy");
      return "ok";
    }, { attempts: 4, baseDelayMs: 0, maxDelayMs: 0, retryable: error => error instanceof Error && error.message.includes("capacity") });
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("does not retry an unclassified failure", async () => {
    const scheduler = new CouncilWorkScheduler();
    let attempts = 0;
    await expect(scheduler.enqueue("send", async () => {
      attempts += 1;
      throw new Error("message may already have been submitted");
    }, { attempts: 5, baseDelayMs: 0, retryable: () => false })).rejects.toThrow(/submitted/);
    expect(attempts).toBe(1);
    expect(scheduler.snapshot().failed).toBe(1);
  });
});
