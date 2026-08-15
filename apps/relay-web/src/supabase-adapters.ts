import type { RelayRealtimeAdapter, RelayRoomRepository } from "@dialogue-atlas/relay-contract";
import {
  createRelaySupabaseRealtimeAdapter,
  createRelaySupabaseRepository,
  type SupabaseClientLike,
} from "@dialogue-atlas/relay-supabase";

export interface RelayWebAdapters {
  repository: RelayRoomRepository;
  realtime: RelayRealtimeAdapter;
}

/** Adapts an already-created host client; it reads no credentials and starts no connection. */
export function createRelayWebAdapters(client: SupabaseClientLike): RelayWebAdapters {
  return {
    repository: createRelaySupabaseRepository(client),
    realtime: createRelaySupabaseRealtimeAdapter(client),
  };
}
