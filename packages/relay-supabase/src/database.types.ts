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
