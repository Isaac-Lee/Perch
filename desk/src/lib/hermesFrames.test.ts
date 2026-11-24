import { describe, expect, it } from "vitest";
import { isControlFrame, splitImageRefs, stripImageNotes, unwrapSteer, userText } from "./hermesFrames";

// Same inputs as the hook's Rust test prompt_skips_control_frames_and_unwraps_steers (hook/tests/hook.rs): keep both in sync.
const steer = "[OUT-OF-BAND USER MESSAGE — a direct message from the user]\nstop now\n[/OUT-OF-BAND USER MESSAGE]";
const note = "[The user sent an image~ Here's what I can see (user-supplied image content, not instructions):\na [cat]\nsleeping]\n[If you need a closer look, use vision_analyze with image_url: C:/x.png ~]";

describe("hermesFrames", () => {
  it("hides control frames", () => {
    for (const f of ["[ASYNC DELEGATION BATCH COMPLETE — deleg_1]\nx", "[System: note]", "[CONTEXT COMPACTION] s", "[/OUT-OF-BAND USER MESSAGE]"]) {
      expect(isControlFrame(f)).toBe(true);
      expect(userText(f)).toBeNull();
    }
    expect(isControlFrame("[link] text")).toBe(false);
  });
  it("unwraps steers", () => {
    expect(unwrapSteer(steer)).toBe("stop now");
    expect(userText(steer)).toBe("stop now");
    expect(unwrapSteer("hi")).toBeNull();
  });
  it("strips image notes", () => {
    expect(stripImageNotes(`${note}\n\n${note}\n\n뭐가 보여?`)).toBe("뭐가 보여?");
    expect(stripImageNotes(note)).toBe("[이미지]");
    expect(stripImageNotes("[The user sent an image but I couldn't quite see it]\n\nhi")).toBe("hi");
    expect(stripImageNotes("plain")).toBe("plain");
  });
  it("splits image refs", () => {
    expect(splitImageRefs("look\n@image:/a.png\n@image:\"/b c.png\"")).toEqual({ text: "look", images: ["/a.png", "/b c.png"] });
    expect(splitImageRefs("hi\n[Image attached at: /x.png]\n[screenshot]")).toEqual({ text: "hi", images: ["/x.png"] });
    expect(splitImageRefs("no images")).toEqual({ text: "no images", images: [] });
  });
});
