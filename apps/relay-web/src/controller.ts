import { useMemo } from "react";
import type { RelayRealtimeAdapter, RelayRoomRepository } from "@dialogue-atlas/relay-contract";
import {
  useRelayRoomController,
  type RelayRoomController,
} from "@dialogue-atlas/relay-room";
import { createRelayFixtureBundle, createRelayFixturePresence } from "./fixture";

export interface RelayWebControllerOptions {
  repository?: RelayRoomRepository;
  realtime?: RelayRealtimeAdapter;
  initialRoomId?: string;
  initialInviteToken?: string;
  storage?: Storage | null;
  onInviteRedeemed?(roomId: string): void;
}

export type RelayWebController = RelayRoomController;

export function useRelayWebController(options: RelayWebControllerOptions = {}): RelayWebController {
  const fixtureBundle = useMemo(() => createRelayFixtureBundle(), []);
  const fixturePresence = useMemo(() => createRelayFixturePresence(), []);
  const staticMode = !options.repository;
  return useRelayRoomController({
    ...options,
    initialBundle: staticMode ? fixtureBundle : undefined,
    initialPresence: staticMode ? fixturePresence : undefined,
    initialSelection: staticMode ? { kind: "node", id: "n005" } : undefined,
    invite: staticMode ? { shareUrl: "https://relay.invalid/join/static-demo" } : undefined,
    demoMode: staticMode,
  });
}
