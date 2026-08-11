import { describe, expect, it } from "vitest";
import { nodeDisplayLabel } from "../src/components/nodeLabel";

describe("fallback node labels", () => {
  it("removes Markdown delimiters from deterministic preview labels only", () => {
    const label = "优先去 **环境栋2楼**，备用 `生协`";
    expect(nodeDisplayLabel(label, true)).toBe("优先去 环境栋2楼，备用 生协");
    expect(nodeDisplayLabel(label, false)).toBe(label);
  });
});
