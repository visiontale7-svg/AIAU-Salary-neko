#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const DEFAULT_REFERENCE = resolve("../../docs/images/dialogue-atlas-living-constellation-b2.png");
const DEFAULT_CANDIDATE = "/tmp/dialogue-atlas-b2-visual/candidate-1586x992.png";
const DEFAULT_OUTPUT = "/tmp/dialogue-atlas-b2-visual/report";

const ROI_DEFINITIONS = [
  { id: "main-spine", x: 65, y: 360, width: 1070, height: 250, weight: 3, threshold: 0.88 },
  { id: "branch-clusters", x: 245, y: 115, width: 620, height: 650, weight: 2.5, threshold: 0.88 },
  { id: "upper-nebula", x: 555, y: 55, width: 605, height: 330, weight: 1.5, threshold: 0.84 },
  { id: "legend", x: 80, y: 65, width: 170, height: 350, weight: 1, threshold: 0.84 },
  { id: "minimap", x: 78, y: 770, width: 235, height: 185, weight: 1, threshold: 0.84 },
  { id: "workbench", x: 1168, y: 14, width: 406, height: 709, weight: 2.5, threshold: 0.88 },
  { id: "devin-panel", x: 1168, y: 734, width: 406, height: 244, weight: 1.5, threshold: 0.84 },
];

const SOURCE_HALO_ROI_SIZE = 96;
const SOURCE_HALO_DEFINITIONS = [
  { id: "value", centerX: 277, centerY: 432 },
  { id: "experience", centerX: 445, centerY: 434 },
  { id: "feasibility", centerX: 603, centerY: 449 },
  { id: "risk", centerX: 752, centerY: 461 },
  { id: "spine-mid", centerX: 901, centerY: 511 },
  { id: "next", centerX: 1031, centerY: 543 },
].map((definition) => ({
  ...definition,
  x: definition.centerX - SOURCE_HALO_ROI_SIZE / 2,
  y: definition.centerY - SOURCE_HALO_ROI_SIZE / 2,
  width: SOURCE_HALO_ROI_SIZE,
  height: SOURCE_HALO_ROI_SIZE,
}));

function parseArguments(argv) {
  const values = {
    reference: DEFAULT_REFERENCE,
    candidate: DEFAULT_CANDIDATE,
    baseline: null,
    output: DEFAULT_OUTPUT,
    enforce: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--enforce") {
      values.enforce = true;
      continue;
    }
    if (["--reference", "--candidate", "--baseline", "--output"].includes(argument)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${argument}`);
      values[argument.slice(2)] = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return values;
}

function asDataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function decodeDataUrl(dataUrl) {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

const options = parseArguments(process.argv.slice(2));
const [referencePng, candidatePng, baselinePng] = await Promise.all([
  readFile(options.reference),
  readFile(options.candidate),
  options.baseline ? readFile(options.baseline) : Promise.resolve(null),
]);
await mkdir(options.output, { recursive: true });

const browser = await chromium.launch({ headless: true });
let artifacts;
try {
  const page = await browser.newPage({ viewport: { width: 1586, height: 992 }, deviceScaleFactor: 1 });
  artifacts = await page.evaluate(
    async ({ referenceUrl, candidateUrl, baselineUrl, rois, sourceHaloRois }) => {
      const loadImage = (url) => new Promise((resolveImage, rejectImage) => {
        const image = new Image();
        image.onload = () => resolveImage(image);
        image.onerror = () => rejectImage(new Error("Unable to decode PNG input"));
        image.src = url;
      });

      const [reference, candidate, baseline] = await Promise.all([
        loadImage(referenceUrl),
        loadImage(candidateUrl),
        baselineUrl ? loadImage(baselineUrl) : Promise.resolve(null),
      ]);
      if (reference.naturalWidth !== candidate.naturalWidth || reference.naturalHeight !== candidate.naturalHeight) {
        throw new Error(
          `Image dimensions differ: reference ${reference.naturalWidth}x${reference.naturalHeight}, `
          + `candidate ${candidate.naturalWidth}x${candidate.naturalHeight}`,
        );
      }
      if (
        baseline
        && (reference.naturalWidth !== baseline.naturalWidth || reference.naturalHeight !== baseline.naturalHeight)
      ) {
        throw new Error(
          `Image dimensions differ: reference ${reference.naturalWidth}x${reference.naturalHeight}, `
          + `baseline ${baseline.naturalWidth}x${baseline.naturalHeight}`,
        );
      }

      const width = reference.naturalWidth;
      const height = reference.naturalHeight;
      const makeCanvas = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
      };
      const rasterize = (image, blur = 0) => {
        const canvas = makeCanvas();
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas 2D is unavailable");
        if (blur > 0) context.filter = `blur(${blur}px)`;
        context.drawImage(image, 0, 0, width, height);
        return context.getImageData(0, 0, width, height).data;
      };

      const referencePixels = rasterize(reference);
      const candidatePixels = rasterize(candidate);
      const referenceBlurred = rasterize(reference, 2);
      const candidateBlurred = rasterize(candidate, 2);
      const baselinePixels = baseline ? rasterize(baseline) : null;
      const baselineBlurred = baseline ? rasterize(baseline, 2) : null;

      const windowedSsim = (left, right, roi, windowSize = 8) => {
        const c1 = (0.01 * 255) ** 2;
        const c2 = (0.03 * 255) ** 2;
        let score = 0;
        let windows = 0;
        const endX = Math.min(width, roi.x + roi.width);
        const endY = Math.min(height, roi.y + roi.height);

        for (let startY = roi.y; startY < endY; startY += windowSize) {
          for (let startX = roi.x; startX < endX; startX += windowSize) {
            const stopX = Math.min(startX + windowSize, endX);
            const stopY = Math.min(startY + windowSize, endY);
            let sumLeft = 0;
            let sumRight = 0;
            let count = 0;
            for (let y = startY; y < stopY; y += 1) {
              for (let x = startX; x < stopX; x += 1) {
                const offset = (y * width + x) * 4;
                sumLeft += 0.2126 * left[offset] + 0.7152 * left[offset + 1] + 0.0722 * left[offset + 2];
                sumRight += 0.2126 * right[offset] + 0.7152 * right[offset + 1] + 0.0722 * right[offset + 2];
                count += 1;
              }
            }
            const meanLeft = sumLeft / count;
            const meanRight = sumRight / count;
            let varianceLeft = 0;
            let varianceRight = 0;
            let covariance = 0;
            for (let y = startY; y < stopY; y += 1) {
              for (let x = startX; x < stopX; x += 1) {
                const offset = (y * width + x) * 4;
                const luminanceLeft = 0.2126 * left[offset] + 0.7152 * left[offset + 1] + 0.0722 * left[offset + 2];
                const luminanceRight = 0.2126 * right[offset] + 0.7152 * right[offset + 1] + 0.0722 * right[offset + 2];
                varianceLeft += (luminanceLeft - meanLeft) ** 2;
                varianceRight += (luminanceRight - meanRight) ** 2;
                covariance += (luminanceLeft - meanLeft) * (luminanceRight - meanRight);
              }
            }
            const divisor = Math.max(1, count - 1);
            varianceLeft /= divisor;
            varianceRight /= divisor;
            covariance /= divisor;
            score += (
              (2 * meanLeft * meanRight + c1) * (2 * covariance + c2)
              / ((meanLeft ** 2 + meanRight ** 2 + c1) * (varianceLeft + varianceRight + c2))
            );
            windows += 1;
          }
        }
        return score / windows;
      };

      const fullRoi = { x: 0, y: 0, width, height };
      const roiResults = rois.map((roi) => ({
        ...roi,
        ssim: windowedSsim(referencePixels, candidatePixels, roi),
        blurredSsim: windowedSsim(referenceBlurred, candidateBlurred, roi),
      }));
      const weightedBlurredSsim = roiResults.reduce(
        (sum, roi) => sum + roi.blurredSsim * roi.weight,
        0,
      ) / roiResults.reduce((sum, roi) => sum + roi.weight, 0);

      const sourceHaloResults = sourceHaloRois.map((roi) => {
        const result = {
          id: roi.id,
          center: { x: roi.centerX, y: roi.centerY },
          roi: { x: roi.x, y: roi.y, width: roi.width, height: roi.height },
          candidate: {
            ssim: windowedSsim(referencePixels, candidatePixels, roi),
            blurredSsim: windowedSsim(referenceBlurred, candidateBlurred, roi),
          },
        };
        if (baselinePixels && baselineBlurred) {
          result.baseline = {
            ssim: windowedSsim(referencePixels, baselinePixels, roi),
            blurredSsim: windowedSsim(referenceBlurred, baselineBlurred, roi),
          };
          result.blurredSsimDelta = result.candidate.blurredSsim - result.baseline.blurredSsim;
        }
        return result;
      });
      const candidateAverageBlurredSsim = sourceHaloResults.reduce(
        (sum, result) => sum + result.candidate.blurredSsim,
        0,
      ) / sourceHaloResults.length;
      const baselineAverageBlurredSsim = baseline
        ? sourceHaloResults.reduce((sum, result) => sum + result.baseline.blurredSsim, 0)
          / sourceHaloResults.length
        : null;

      const mainSpineRoi = rois.find((roi) => roi.id === "main-spine");
      const spineAnchors = [
        [144, 488], [277, 432], [445, 434], [603, 449],
        [752, 461], [901, 511], [1031, 543],
      ];
      const expectedSpineY = (x) => {
        for (let index = 0; index < spineAnchors.length - 1; index += 1) {
          const [startX, startY] = spineAnchors[index];
          const [endX, endY] = spineAnchors[index + 1];
          if (x >= startX && x <= endX) {
            const progress = (x - startX) / (endX - startX);
            return startY + (endY - startY) * progress;
          }
        }
        return null;
      };
      const isInsideSpineCorridor = (x, y) => {
        const expectedY = expectedSpineY(x);
        if (expectedY === null || Math.abs(y - expectedY) > 18) return false;
        return !spineAnchors.some(([nodeX, nodeY]) => (x - nodeX) ** 2 + (y - nodeY) ** 2 <= 30 ** 2);
      };
      const blueMask = (pixels, roi) => {
        const mask = new Uint8Array(width * height);
        const endX = Math.min(width, roi.x + roi.width);
        const endY = Math.min(height, roi.y + roi.height);
        for (let y = roi.y; y < endY; y += 1) {
          for (let x = roi.x; x < endX; x += 1) {
            if (!isInsideSpineCorridor(x, y)) continue;
            const offset = (y * width + x) * 4;
            const red = pixels[offset];
            const green = pixels[offset + 1];
            const blue = pixels[offset + 2];
            if (blue >= 90 && blue - red >= 20 && blue - green >= 3) mask[y * width + x] = 1;
          }
        }
        return mask;
      };
      const dilate = (mask, roi, radius) => {
        const result = new Uint8Array(width * height);
        const endX = Math.min(width, roi.x + roi.width);
        const endY = Math.min(height, roi.y + roi.height);
        for (let y = roi.y; y < endY; y += 1) {
          for (let x = roi.x; x < endX; x += 1) {
            if (!mask[y * width + x]) continue;
            for (let deltaY = -radius; deltaY <= radius; deltaY += 1) {
              for (let deltaX = -radius; deltaX <= radius; deltaX += 1) {
                if (deltaX ** 2 + deltaY ** 2 > radius ** 2) continue;
                const targetX = x + deltaX;
                const targetY = y + deltaY;
                if (targetX < roi.x || targetX >= endX || targetY < roi.y || targetY >= endY) continue;
                result[targetY * width + targetX] = 1;
              }
            }
          }
        }
        return result;
      };
      const referenceSpine = dilate(blueMask(referencePixels, mainSpineRoi), mainSpineRoi, 3);
      const candidateSpine = dilate(blueMask(candidatePixels, mainSpineRoi), mainSpineRoi, 3);
      let spineIntersection = 0;
      let spineUnion = 0;
      for (let index = 0; index < referenceSpine.length; index += 1) {
        if (referenceSpine[index] && candidateSpine[index]) spineIntersection += 1;
        if (referenceSpine[index] || candidateSpine[index]) spineUnion += 1;
      }
      const mainSpineIou = spineUnion > 0 ? spineIntersection / spineUnion : 0;

      const overlayCanvas = makeCanvas();
      const overlayContext = overlayCanvas.getContext("2d");
      overlayContext.drawImage(reference, 0, 0, width, height);
      overlayContext.globalAlpha = 0.5;
      overlayContext.drawImage(candidate, 0, 0, width, height);
      overlayContext.globalAlpha = 1;

      const heatmapCanvas = makeCanvas();
      const heatmapContext = heatmapCanvas.getContext("2d");
      const heatmap = heatmapContext.createImageData(width, height);
      for (let offset = 0; offset < heatmap.data.length; offset += 4) {
        const difference = (
          Math.abs(referencePixels[offset] - candidatePixels[offset])
          + Math.abs(referencePixels[offset + 1] - candidatePixels[offset + 1])
          + Math.abs(referencePixels[offset + 2] - candidatePixels[offset + 2])
        ) / 3;
        const value = Math.min(1, difference / 96);
        heatmap.data[offset] = Math.round(255 * Math.min(1, value * 1.5));
        heatmap.data[offset + 1] = Math.round(255 * Math.max(0, 1 - Math.abs(value - 0.55) * 2));
        heatmap.data[offset + 2] = Math.round(255 * Math.max(0, 1 - value * 2));
        heatmap.data[offset + 3] = 255;
      }
      heatmapContext.putImageData(heatmap, 0, 0);

      const quadCanvas = makeCanvas();
      const quadContext = quadCanvas.getContext("2d");
      const halfWidth = Math.floor(width / 2);
      const halfHeight = Math.floor(height / 2);
      quadContext.fillStyle = "#020713";
      quadContext.fillRect(0, 0, width, height);
      quadContext.drawImage(reference, 0, 0, width, height, 0, 0, halfWidth, halfHeight);
      quadContext.drawImage(candidate, 0, 0, width, height, halfWidth, 0, width - halfWidth, halfHeight);
      quadContext.drawImage(overlayCanvas, 0, 0, width, height, 0, halfHeight, halfWidth, height - halfHeight);
      quadContext.drawImage(heatmapCanvas, 0, 0, width, height, halfWidth, halfHeight, width - halfWidth, height - halfHeight);
      quadContext.strokeStyle = "rgba(255,255,255,.45)";
      quadContext.lineWidth = 2;
      quadContext.beginPath();
      quadContext.moveTo(halfWidth, 0);
      quadContext.lineTo(halfWidth, height);
      quadContext.moveTo(0, halfHeight);
      quadContext.lineTo(width, halfHeight);
      quadContext.stroke();

      return {
        width,
        height,
        fullFrameSsim: windowedSsim(referencePixels, candidatePixels, fullRoi),
        blurredFullFrameSsim: windowedSsim(referenceBlurred, candidateBlurred, fullRoi),
        weightedBlurredSsim,
        mainSpineIou,
        rois: roiResults,
        sourceHalos: {
          roiSize: sourceHaloRois[0]?.width ?? 0,
          rois: sourceHaloResults,
          candidateAverageBlurredSsim,
          baselineAverageBlurredSsim,
          averageBlurredSsimDelta: baselineAverageBlurredSsim === null
            ? null
            : candidateAverageBlurredSsim - baselineAverageBlurredSsim,
        },
        overlay: overlayCanvas.toDataURL("image/png"),
        heatmap: heatmapCanvas.toDataURL("image/png"),
        quad: quadCanvas.toDataURL("image/png"),
      };
    },
    {
      referenceUrl: asDataUrl(referencePng),
      candidateUrl: asDataUrl(candidatePng),
      baselineUrl: baselinePng ? asDataUrl(baselinePng) : null,
      rois: ROI_DEFINITIONS,
      sourceHaloRois: SOURCE_HALO_DEFINITIONS,
    },
  );
} finally {
  await browser.close();
}

const report = {
  schemaVersion: "b2-visual-report-v1",
  generatedAt: new Date().toISOString(),
  reference: {
    path: options.reference,
    sha256: createHash("sha256").update(referencePng).digest("hex"),
  },
  candidate: {
    path: options.candidate,
    sha256: createHash("sha256").update(candidatePng).digest("hex"),
  },
  ...(baselinePng ? {
    baseline: {
      path: options.baseline,
      sha256: createHash("sha256").update(baselinePng).digest("hex"),
    },
  } : {}),
  dimensions: { width: artifacts.width, height: artifacts.height, deviceScaleFactor: 1 },
  metrics: {
    fullFrameSsim: artifacts.fullFrameSsim,
    blurredFullFrameSsim: artifacts.blurredFullFrameSsim,
    weightedBlurredRoiSsim: artifacts.weightedBlurredSsim,
    mainSpineIou: artifacts.mainSpineIou,
    rois: artifacts.rois,
    sourceHalos: artifacts.sourceHalos,
  },
  thresholds: {
    fullFrameSsim: 0.88,
    weightedBlurredRoiSsim: 0.90,
    mainSpineIou: 0.90,
    ...(baselinePng ? { sourceHaloAverageBlurredSsimDelta: { operator: ">", value: 0 } } : {}),
  },
  pass: (
    artifacts.fullFrameSsim >= 0.88
    && artifacts.weightedBlurredSsim >= 0.90
    && artifacts.mainSpineIou >= 0.90
    && artifacts.rois.every((roi) => roi.blurredSsim >= roi.threshold)
    && (!baselinePng || artifacts.sourceHalos.averageBlurredSsimDelta > 0)
  ),
  artifactOrder: {
    quad: ["reference", "candidate", "50%-overlay", "heatmap"],
  },
};

await Promise.all([
  writeFile(resolve(options.output, "overlay.png"), decodeDataUrl(artifacts.overlay)),
  writeFile(resolve(options.output, "heatmap.png"), decodeDataUrl(artifacts.heatmap)),
  writeFile(resolve(options.output, "comparison-quad.png"), decodeDataUrl(artifacts.quad)),
  writeFile(resolve(options.output, "report.json"), `${JSON.stringify(report, null, 2)}\n`),
]);

console.log(JSON.stringify({
  report: resolve(options.output, "report.json"),
  fullFrameSsim: report.metrics.fullFrameSsim,
  weightedBlurredRoiSsim: report.metrics.weightedBlurredRoiSsim,
  mainSpineIou: report.metrics.mainSpineIou,
  sourceHaloAverageBlurredSsim: report.metrics.sourceHalos.candidateAverageBlurredSsim,
  sourceHaloAverageBlurredSsimBaseline: report.metrics.sourceHalos.baselineAverageBlurredSsim,
  sourceHaloAverageBlurredSsimDelta: report.metrics.sourceHalos.averageBlurredSsimDelta,
  pass: report.pass,
}, null, 2));

if (options.enforce && !report.pass) process.exitCode = 1;
