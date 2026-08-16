import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import deepSpaceTextureUrl from "./assets/b2-deep-space@2x.webp";
import {
  B2_BACKGROUND_HEIGHT,
  B2_BACKGROUND_SEED,
  B2_BACKGROUND_WIDTH,
  clampB2DevicePixelRatio,
  createB2StarfieldPlan,
  renderB2BackgroundFrame,
  type B2NebulaTexture,
} from "./b2-background";

export interface B2StarfieldReady {
  seed: number;
  particleCount: number;
  glintCount: number;
  textureDecoded: boolean;
  staticMode: boolean;
  dpr: number;
}

export interface B2StarfieldCanvasProps {
  className?: string;
  seed?: number;
  staticMode?: boolean;
  texture?: CanvasImageSource;
  textureOpacity?: number;
  onReady?(state: B2StarfieldReady): void;
}

interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
}

type TextureState =
  | { status: "loading"; image: null }
  | { status: "decoded"; image: HTMLImageElement }
  | { status: "failed"; image: null };

const CANVAS_STYLE: CSSProperties = {
  position: "absolute",
  zIndex: 0,
  inset: 0,
  display: "block",
  width: "100%",
  height: "100%",
  pointerEvents: "none",
};

function useLocalDeepSpaceTexture(disabled: boolean): TextureState {
  const [state, setState] = useState<TextureState>(disabled
    ? { status: "failed", image: null }
    : { status: "loading", image: null });

  useEffect(() => {
    if (disabled) {
      setState({ status: "failed", image: null });
      return;
    }

    let disposed = false;
    const image = new Image();
    image.decoding = "async";
    image.src = deepSpaceTextureUrl;

    async function decode(): Promise<void> {
      try {
        if (typeof image.decode === "function") {
          await image.decode();
        } else if (!image.complete) {
          await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error("B2 deep-space texture failed to load"));
          });
        }

        if (!disposed && image.naturalWidth > 0 && image.naturalHeight > 0) {
          setState({ status: "decoded", image });
        } else if (!disposed) {
          setState({ status: "failed", image: null });
        }
      } catch {
        if (!disposed && image.complete && image.naturalWidth > 0) {
          setState({ status: "decoded", image });
        } else if (!disposed) {
          setState({ status: "failed", image: null });
        }
      }
    }

    void decode();
    return () => {
      disposed = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [disabled]);

  return state;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return reduced;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
}

export function B2StarfieldCanvas({
  className,
  seed = B2_BACKGROUND_SEED,
  staticMode = false,
  texture,
  textureOpacity = 0.46,
  onReady,
}: B2StarfieldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedSecondsRef = useRef(0);
  const readyKeyRef = useRef("");
  const onReadyRef = useRef(onReady);
  const reducedMotion = usePrefersReducedMotion();
  const documentVisible = useDocumentVisible();
  const textureState = useLocalDeepSpaceTexture(Boolean(texture));
  const [size, setSize] = useState<CanvasSize>({
    width: B2_BACKGROUND_WIDTH,
    height: B2_BACKGROUND_HEIGHT,
    dpr: 1,
  });
  const plan = useMemo(() => createB2StarfieldPlan({ seed }), [seed]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    elapsedSecondsRef.current = 0;
    readyKeyRef.current = "";
  }, [seed]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const element = canvas;

    function measure(): void {
      const rect = element.getBoundingClientRect();
      const width = rect.width > 0 ? rect.width : B2_BACKGROUND_WIDTH;
      const height = rect.height > 0 ? rect.height : B2_BACKGROUND_HEIGHT;
      const dpr = clampB2DevicePixelRatio(window.devicePixelRatio || 1);
      setSize((current) => current.width === width && current.height === height && current.dpr === dpr
        ? current
        : { width, height, dpr });
    }

    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !context) return;
    const drawingContext = context;

    const pixelWidth = Math.max(1, Math.round(size.width * size.dpr));
    const pixelHeight = Math.max(1, Math.round(size.height * size.dpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    const decodedTexture = texture ?? (textureState.status === "decoded" ? textureState.image : undefined);
    const nebulaTexture: B2NebulaTexture | undefined = decodedTexture
      ? { source: decodedTexture, opacity: Math.min(1, Math.max(0, textureOpacity)) }
      : undefined;
    const shouldAnimate = !staticMode && !reducedMotion && documentVisible;
    let frame = 0;
    let lastFrameTime: number | null = null;

    function draw(timeSeconds: number, animate: boolean): void {
      renderB2BackgroundFrame(drawingContext, plan, {
        cssWidth: size.width,
        cssHeight: size.height,
        dpr: size.dpr,
        texture: nebulaTexture,
        timeSeconds,
        animate,
      });
    }

    draw(staticMode ? 0 : elapsedSecondsRef.current, shouldAnimate);

    const textureDecoded = Boolean(texture) || textureState.status === "decoded";
    if (textureState.status !== "loading" || texture) {
      const readyKey = `${seed}:${size.dpr}:${staticMode}:${textureDecoded}`;
      if (readyKeyRef.current !== readyKey) {
        readyKeyRef.current = readyKey;
        onReadyRef.current?.({
          seed,
          particleCount: plan.particles.length,
          glintCount: plan.glints.length,
          textureDecoded,
          staticMode,
          dpr: size.dpr,
        });
      }
    }

    if (shouldAnimate) {
      const tick = (now: number) => {
        if (lastFrameTime !== null) {
          elapsedSecondsRef.current += Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
        }
        lastFrameTime = now;
        draw(elapsedSecondsRef.current, true);
        frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
    }

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [documentVisible, plan, reducedMotion, seed, size, staticMode, texture, textureOpacity, textureState]);

  const animationState = staticMode || reducedMotion ? "static" : documentVisible ? "ambient" : "paused";
  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      data-b2-starfield="true"
      data-animation-state={animationState}
      data-seed={seed}
      data-texture-state={texture ? "decoded" : textureState.status}
      style={CANVAS_STYLE}
    />
  );
}

export default B2StarfieldCanvas;
