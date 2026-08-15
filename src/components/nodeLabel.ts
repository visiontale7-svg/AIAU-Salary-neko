export const nodeDisplayLabel = (label: string, fallback: boolean) => fallback
  ? label.replaceAll("**", "").replaceAll("__", "").replaceAll("`", "")
  : label;
