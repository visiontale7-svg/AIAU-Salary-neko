/**
 * Narrow checked-in row contract for the Relay tables used by this package.
 * Regenerate this file from a configured Supabase project before deployment;
 * keeping it local lets the offline MVP typecheck without a project reference.
 */
export interface RoomRow {
  id: string;
  owner_id: string;
  title: string;
  status: "open" | "closed";
  current_version_id: string;
  revision: number;
}

export interface RoomMemberRow {
  room_id: string;
  user_id: string;
  display_name: string;
  role: "owner" | "member";
  color_key: string;
}

export interface AtlasVersionRow {
  id: string;
  room_id: string;
  version: number;
  package: unknown;
}

export interface LayoutRow {
  room_id: string;
  atlas_version_id: string;
  node_id: string;
  x: number;
  y: number;
  revision: number;
  updated_by: string;
}

export interface TeamItemRow {
  room_id: string;
  atlas_version_id: string;
  item_id: string;
  item_type: "node" | "edge";
  payload: Record<string, unknown>;
  revision: number;
  created_by: string;
}

export interface DevinRunRow {
  id: string;
  room_id: string;
  action_brief_id: string;
  external_session_id: string | null;
  external_url: string | null;
  state: string;
  status_detail: string | null;
  pull_request_url: string | null;
  pull_request_state: string | null;
  checks_state: "unknown" | "pending" | "passing" | "failing" | null;
  provider_health: "healthy" | "delayed" | "stale" | "unknown";
  last_successful_poll_at: string | null;
  last_provider_event_at: string | null;
  consecutive_failures: number;
  retry_after_at: string | null;
  updated_at: string;
}

export interface DevinEventRow {
  id: string;
  run_id: string;
  external_event_id: string | null;
  event_type: string;
  actor_type: "devin" | "owner" | "system";
  created_at: string;
  text: string;
}
