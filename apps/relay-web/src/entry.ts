interface RelayEntryLocation {
  pathname: string;
  search: string;
  hash: string;
}

function isProtectedRelayEntry(location: RelayEntryLocation, query: URLSearchParams): boolean {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  return location.pathname !== "/" || query.has("room") || fragment.has("invite");
}

export function shouldRenderB2HaloLab(location: RelayEntryLocation): boolean {
  const query = new URLSearchParams(location.search);
  if (isProtectedRelayEntry(location, query)) return false;
  return query.get("demo") === "b2"
    && query.get("haloLab") === "1"
    && query.get("motionLab") !== "1";
}

export function shouldRenderB2MotionLab(location: RelayEntryLocation): boolean {
  const query = new URLSearchParams(location.search);
  if (isProtectedRelayEntry(location, query)) return false;
  return query.get("demo") === "b2" && query.get("motionLab") === "1";
}

export function shouldRenderB2VisualDemo(location: RelayEntryLocation): boolean {
  const query = new URLSearchParams(location.search);
  if (isProtectedRelayEntry(location, query)) return false;
  return query.get("demo") === "b2"
    && query.get("haloLab") !== "1"
    && query.get("motionLab") !== "1";
}
