import type { RelayRealtimeAdapter, RelayRoomRepository } from "@dialogue-atlas/relay-contract";
import { RelayRoom } from "@dialogue-atlas/relay-room";
import { useRelayWebController } from "./controller";

export interface RelayWebAppProps {
  repository?: RelayRoomRepository;
  realtime?: RelayRealtimeAdapter;
  initialRoomId?: string;
  initialInviteToken?: string;
  storage?: Storage | null;
  onInviteRedeemed?(roomId: string): void;
}

function queryDefaults(): { roomId?: string; inviteToken?: string } {
  if (typeof window === "undefined") return {};
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return {
    roomId: query.get("room") || undefined,
    inviteToken: fragment.get("invite") || undefined,
  };
}

export function RelayWebApp({ repository, realtime, initialRoomId, initialInviteToken, storage, onInviteRedeemed }: RelayWebAppProps) {
  const defaults = queryDefaults();
  const controller = useRelayWebController({
    repository,
    realtime,
    initialRoomId: initialRoomId ?? defaults.roomId,
    initialInviteToken: initialInviteToken ?? defaults.inviteToken,
    storage: storage === undefined && typeof window !== "undefined" ? window.localStorage : storage,
    onInviteRedeemed,
  });
  return <RelayRoom model={controller.model} callbacks={controller.callbacks} />;
}

export default RelayWebApp;
