import rootBlueV0 from "./assets/halos/root-blue-v0@2x.png";
import sourceBlueV0 from "./assets/halos/source-blue-v0@2x.png";
import sourceBlueV1 from "./assets/halos/source-blue-v1@2x.png";
import sourceBlueV2 from "./assets/halos/source-blue-v2@2x.png";
import teamVioletV0 from "./assets/halos/team-violet-v0@2x.png";
import teamVioletV1 from "./assets/halos/team-violet-v1@2x.png";
import teamCyanV0 from "./assets/halos/team-cyan-v0@2x.png";
import teamCyanV1 from "./assets/halos/team-cyan-v1@2x.png";
import teamGreenV0 from "./assets/halos/team-green-v0@2x.png";
import teamGreenV1 from "./assets/halos/team-green-v1@2x.png";
import teamOrangeV0 from "./assets/halos/team-orange-v0@2x.png";
import teamOrangeV1 from "./assets/halos/team-orange-v1@2x.png";
import questionRedV0 from "./assets/halos/question-red-v0@2x.png";
import candidateSilverV0 from "./assets/halos/candidate-silver-v0@2x.png";

export type HaloAssetKey =
  | "root-blue-v0"
  | "source-blue-v0"
  | "source-blue-v1"
  | "source-blue-v2"
  | "team-violet-v0"
  | "team-violet-v1"
  | "team-cyan-v0"
  | "team-cyan-v1"
  | "team-green-v0"
  | "team-green-v1"
  | "team-orange-v0"
  | "team-orange-v1"
  | "question-red-v0"
  | "candidate-silver-v0";

export interface HaloAssetDefinition {
  src: string;
  displaySize: number;
  pixelSize: number;
  sha256: string;
}

export const HALO_ASSETS: Record<HaloAssetKey, HaloAssetDefinition> = {
  "root-blue-v0": {
    src: rootBlueV0,
    displaySize: 176,
    pixelSize: 352,
    sha256: "307c46347510fe0c33f92b88d8862f3ab7f3544464985e28e0f178df2457b016",
  },
  "source-blue-v0": {
    src: sourceBlueV0,
    displaySize: 144,
    pixelSize: 288,
    sha256: "f1a033057caccab9b736448db4ef42123915f3008d5325c3de92972d85d03c3f",
  },
  "source-blue-v1": {
    src: sourceBlueV1,
    displaySize: 144,
    pixelSize: 288,
    sha256: "7a045835c98d826b0b4f3e976f3d0cc7a967c80dacb1564d777e4c37285cfb59",
  },
  "source-blue-v2": {
    src: sourceBlueV2,
    displaySize: 144,
    pixelSize: 288,
    sha256: "1f4c4392f6b0368e5c2bcc18dceb00504e37d914d3bd1b04b1bf5fae35084e28",
  },
  "team-violet-v0": {
    src: teamVioletV0,
    displaySize: 80,
    pixelSize: 160,
    sha256: "23b357504400801f65d27660f4ab855617cacf243d741fb5d1d43588a6930791",
  },
  "team-violet-v1": {
    src: teamVioletV1,
    displaySize: 80,
    pixelSize: 160,
    sha256: "0fb8087d6833932047c99eef527bce2782c91a1d94d5867b8df4d4d75640cefe",
  },
  "team-cyan-v0": {
    src: teamCyanV0,
    displaySize: 80,
    pixelSize: 160,
    sha256: "037fb67624d879c6b19276455f64768248db1a70b071c0e6c39bd2df98ff4916",
  },
  "team-cyan-v1": {
    src: teamCyanV1,
    displaySize: 80,
    pixelSize: 160,
    sha256: "a2617b34cd490d3717a7e1a65ee66f4a743596916af95569124d38e15a1c6a72",
  },
  "team-green-v0": {
    src: teamGreenV0,
    displaySize: 80,
    pixelSize: 160,
    sha256: "f408c061367c5d4f90970d9eb311a6d70642987b7631cbdd9ea08ec9c72d5321",
  },
  "team-green-v1": {
    src: teamGreenV1,
    displaySize: 80,
    pixelSize: 160,
    sha256: "96f2429c2a5b1c5a78e3e6e54aa9c0ea4ebbab7df54d56ff16dc150c3bcadd18",
  },
  "team-orange-v0": {
    src: teamOrangeV0,
    displaySize: 80,
    pixelSize: 160,
    sha256: "dfab2de67aecdfd892efa2bcbe6d35740741928a46a38c1c2ef8e25fb897b1f4",
  },
  "team-orange-v1": {
    src: teamOrangeV1,
    displaySize: 80,
    pixelSize: 160,
    sha256: "a2ff71abb29dd7d9986dc255519f892c2c6837e1e2fba3af5bd5f89e7e1ac36c",
  },
  "question-red-v0": {
    src: questionRedV0,
    displaySize: 88,
    pixelSize: 176,
    sha256: "47d26132c6c4a29e1b813853a32aad1663badd7e3eeea7f1e0caba889cf475b3",
  },
  "candidate-silver-v0": {
    src: candidateSilverV0,
    displaySize: 88,
    pixelSize: 176,
    sha256: "4258dc53e8e8b9bc1c36473d6591276a66fdea00db11b0276c2c36dc861de979",
  },
};

const decodeCache = new Map<HaloAssetKey, Promise<void>>();

function decodeHaloAsset(key: HaloAssetKey): Promise<void> {
  const cached = decodeCache.get(key);
  if (cached) return cached;

  const pending = new Promise<void>((resolve, reject) => {
    if (typeof Image === "undefined") {
      reject(new Error(`Cannot decode halo asset ${key} outside a browser image environment`));
      return;
    }
    const definition = HALO_ASSETS[key];
    if (!definition?.src) {
      reject(new Error(`Halo asset ${key} is missing`));
      return;
    }
    const image = new Image();
    image.decoding = "async";
    image.src = definition.src;
    image.decode()
      .then(() => {
        if (image.naturalWidth !== definition.pixelSize || image.naturalHeight !== definition.pixelSize) {
          throw new Error(
            `Halo asset ${key} decoded at ${image.naturalWidth}x${image.naturalHeight}; `
            + `expected ${definition.pixelSize}x${definition.pixelSize}`,
          );
        }
      })
      .then(resolve, reject);
  });
  decodeCache.set(key, pending);
  pending.catch(() => decodeCache.delete(key));
  return pending;
}

export async function decodeHaloAssets(keys?: readonly HaloAssetKey[]): Promise<void> {
  const requested = keys ?? (Object.keys(HALO_ASSETS) as HaloAssetKey[]);
  await Promise.all(requested.map(decodeHaloAsset));
}
