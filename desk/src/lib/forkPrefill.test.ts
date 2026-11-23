import { expect, it } from "vitest";
import { setPrefill, takePrefill } from "./forkPrefill";
it("prefill is taken once per session", () => {
  setPrefill("s1", { text: "hi", send: true });
  expect(takePrefill("s1")).toEqual({ text: "hi", send: true });
  expect(takePrefill("s1")).toBeUndefined();
  expect(takePrefill("other")).toBeUndefined();
});
