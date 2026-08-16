import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StarAura, StarBody, StarOptics, type StarOpticsSpec } from "./StarOptics";

const SOURCE_SPEC: StarOpticsSpec = {
  family: "source",
  tone: "blue",
  assetKey: "source-blue-v0",
  energy: 2,
  shellRadius: 12.5,
  coreSize: 6.8,
};

describe("StarOptics", () => {
  it("keeps far aura and sharp body as separately composable SVG passes", () => {
    const { container } = render(
      <svg viewBox="0 0 96 96">
        <StarAura spec={SOURCE_SPEC} x={48} y={48} />
        <path data-testid="sharp-path-core" d="M0 48 H96" />
        <StarBody spec={SOURCE_SPEC} x={48} y={48} state="selected" />
      </svg>,
    );

    expect(container.querySelector('[data-star-aura-family="source"] image')).not.toBeNull();
    expect(container.querySelector('[data-star-body-family="source"]')).toHaveAttribute("data-star-state", "selected");
    expect(container.querySelector("animate")).toBeNull();

    const orderedPasses = Array.from(container.querySelector("svg")?.children ?? []);
    expect(orderedPasses[0]).toHaveAttribute("data-star-aura-family", "source");
    expect(orderedPasses[1]).toHaveAttribute("data-testid", "sharp-path-core");
    expect(orderedPasses[2]).toHaveAttribute("data-star-body-family", "source");
  });

  it("creates collision-free local SVG definitions for repeated samples", () => {
    const { container } = render(
      <svg viewBox="0 0 192 96">
        <StarOptics spec={SOURCE_SPEC} x={48} y={48} />
        <StarOptics spec={{ ...SOURCE_SPEC, assetKey: "source-blue-v1" }} x={144} y={48} />
      </svg>,
    );

    const ids = Array.from(container.querySelectorAll("[id]"), (element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps Devin on the dedicated diamond material without a halo texture", () => {
    const { container } = render(
      <svg viewBox="0 0 96 96">
        <StarOptics
          spec={{ family: "devin", tone: "silver", energy: 2, shellRadius: 10, coreSize: 5 }}
          x={48}
          y={48}
        />
      </svg>,
    );

    expect(container.querySelector('[data-star-aura-family="devin"] image')).toBeNull();
    expect(container.querySelector('[data-star-body-family="devin"] rect')).not.toBeNull();
  });
});
