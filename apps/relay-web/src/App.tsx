import type { RelayRealtimeAdapter, RelayRoomRepository } from "@dialogue-atlas/relay-contract";
import { RelayRoom } from "@dialogue-atlas/relay-room";
import { useEffect, useState } from "react";
import { useRelayWebController } from "./controller";
import { B2RoomView } from "./b2-room/B2RoomView";

export interface RelayWebAppProps {
  repository?: RelayRoomRepository;
  realtime?: RelayRealtimeAdapter;
  initialRoomId?: string;
  initialInviteToken?: string;
  storage?: Storage | null;
  onInviteRedeemed?(roomId: string): void;
  readyView?: "classic" | "b2";
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

export function RelayWebApp({ repository, realtime, initialRoomId, initialInviteToken, storage, onInviteRedeemed, readyView = "classic" }: RelayWebAppProps) {
  const defaults = queryDefaults();
  const controller = useRelayWebController({
    repository,
    realtime,
    initialRoomId: initialRoomId ?? defaults.roomId,
    initialInviteToken: initialInviteToken ?? defaults.inviteToken,
    storage: storage === undefined && typeof window !== "undefined" ? window.localStorage : storage,
    onInviteRedeemed,
  });
  const [structuredView, setStructuredView] = useState(false);
  const roomId = controller.model.phase === "ready" ? controller.model.bundle.room.id : undefined;
  useEffect(() => setStructuredView(false), [roomId]);

  if (readyView === "b2" && controller.model.phase === "ready" && !structuredView) {
    return (
      <B2RoomView
        model={controller.model}
        callbacks={controller.callbacks}
        onOpenStructuredView={() => setStructuredView(true)}
      />
    );
  }
  return <RelayRoom model={controller.model} callbacks={controller.callbacks} />;
}

export default RelayWebApp;
