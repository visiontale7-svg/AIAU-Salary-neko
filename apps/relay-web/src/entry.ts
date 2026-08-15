interface RelayEntryLocation {
  pathname: string;
  search: string;
  hash: string;
}

export function shouldRenderB2VisualDemo(location: RelayEntryLocation): boolean {
  if (location.pathname !== "/") return false;
  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  return query.get("demo") === "b2"
    && !query.has("room")
    && !fragment.has("invite");
}
