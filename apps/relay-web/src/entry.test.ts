import { describe, expect, it } from "vitest";
import { shouldRenderB2HaloLab, shouldRenderB2MotionLab, shouldRenderB2VisualDemo } from "./entry";

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

  it("selects the halo lab only for its explicit root query", () => {
    expect(shouldRenderB2HaloLab({ pathname: "/", search: "?demo=b2&haloLab=1", hash: "" })).toBe(true);
    expect(shouldRenderB2VisualDemo({ pathname: "/", search: "?demo=b2&haloLab=1", hash: "" })).toBe(false);
    expect(shouldRenderB2HaloLab({ pathname: "/", search: "?demo=b2", hash: "" })).toBe(false);
    expect(shouldRenderB2HaloLab({ pathname: "/room/room_1", search: "?demo=b2&haloLab=1", hash: "" })).toBe(false);
    expect(shouldRenderB2HaloLab({ pathname: "/", search: "?demo=b2&haloLab=1&room=room_1", hash: "" })).toBe(false);
    expect(shouldRenderB2HaloLab({ pathname: "/", search: "?demo=b2&haloLab=1", hash: "#invite=secret" })).toBe(false);
  });

  it("selects the motion lab only for its explicit root query", () => {
    expect(shouldRenderB2MotionLab({ pathname: "/", search: "?demo=b2&motionLab=1", hash: "" })).toBe(true);
    expect(shouldRenderB2VisualDemo({ pathname: "/", search: "?demo=b2&motionLab=1", hash: "" })).toBe(false);
    expect(shouldRenderB2MotionLab({ pathname: "/", search: "?demo=b2", hash: "" })).toBe(false);
    expect(shouldRenderB2MotionLab({ pathname: "/room/room_1", search: "?demo=b2&motionLab=1", hash: "" })).toBe(false);
    expect(shouldRenderB2MotionLab({ pathname: "/", search: "?demo=b2&motionLab=1&room=room_1", hash: "" })).toBe(false);
    expect(shouldRenderB2MotionLab({ pathname: "/", search: "?demo=b2&motionLab=1", hash: "#invite=secret" })).toBe(false);
    expect(shouldRenderB2MotionLab({ pathname: "/", search: "?demo=b2&haloLab=1&motionLab=1", hash: "" })).toBe(true);
    expect(shouldRenderB2HaloLab({ pathname: "/", search: "?demo=b2&haloLab=1&motionLab=1", hash: "" })).toBe(false);
  });
});
