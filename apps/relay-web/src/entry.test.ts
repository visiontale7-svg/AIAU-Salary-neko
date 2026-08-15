import { describe, expect, it } from "vitest";
import { shouldRenderB2VisualDemo } from "./entry";

describe("shouldRenderB2VisualDemo", () => {
  it("selects only the explicit root visual-demo query", () => {
    expect(shouldRenderB2VisualDemo({ pathname: "/", search: "?demo=b2", hash: "" })).toBe(true);
    expect(shouldRenderB2VisualDemo({ pathname: "/", search: "", hash: "" })).toBe(false);
    expect(shouldRenderB2VisualDemo({ pathname: "/", search: "?demo=other", hash: "" })).toBe(false);
  });

  it("never shadows room or invite flows", () => {
    expect(shouldRenderB2VisualDemo({ pathname: "/room/room_1", search: "?demo=b2", hash: "" })).toBe(false);
    expect(shouldRenderB2VisualDemo({ pathname: "/", search: "?demo=b2&room=room_1", hash: "" })).toBe(false);
    expect(shouldRenderB2VisualDemo({ pathname: "/", search: "?demo=b2", hash: "#invite=secret" })).toBe(false);
  });
});
