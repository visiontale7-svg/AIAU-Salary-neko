import { useEffect, useState } from "react";
import { RelayRoom, useRelayRoomController } from "@dialogue-atlas/relay-room";
import type { RelayRealtimeAdapter, RelayRoomRepository } from "@dialogue-atlas/relay-contract";
import { B2RoomView } from "../../apps/relay-web/src/b2-room/B2RoomView";
import { useAtlasStore } from "../store";
import { RelayIcon } from "../components/icons";
import { relayRuntimeAdapters, relayRuntimeConfig } from "./relayPublisher";

function RelayOwnerRoom({
  roomId,
  repository,
  realtime,
  inviteUrl,
}: {
  roomId: string;
  repository: RelayRoomRepository;
  realtime: RelayRealtimeAdapter;
  inviteUrl: string | null;
}) {
  const controller = useRelayRoomController({
    repository,
    realtime,
    initialRoomId: roomId,
    storage: window.localStorage,
    invite: inviteUrl ? { shareUrl: inviteUrl } : undefined,
  });
  const [structuredView, setStructuredView] = useState(false);

  useEffect(() => setStructuredView(false), [roomId]);

  if (controller.model.phase === "ready" && !structuredView) {
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

export function RelayOwnerView() {
  const roomId = useAtlasStore((state) => state.activeRelayRoomId);
  const relayUrl = useAtlasStore((state) => state.activeRelayUrl);
  const setShare = useAtlasStore((state) => state.setShare);
  const [adapters, setAdapters] = useState<{ repository: RelayRoomRepository; realtime: RelayRealtimeAdapter } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const transientInviteUrl = relayUrl?.includes("#invite=") ? relayUrl : null;
  let configured = false;
  try { configured = relayRuntimeConfig() !== null; } catch { configured = false; }

  useEffect(() => {
    let active = true;
    if (!roomId || !configured) {
      setAdapters(null);
      return () => { active = false; };
    }
    void relayRuntimeAdapters().then((next) => {
      if (active) setAdapters(next);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "无法连接 Relay");
    });
    return () => { active = false; };
  }, [configured, roomId]);

  if (roomId && adapters) {
    return <div className="relay-owner-host">
      <RelayOwnerRoom
        roomId={roomId}
        repository={adapters.repository}
        realtime={adapters.realtime}
        inviteUrl={transientInviteUrl}
      />
    </div>;
  }

  return (
    <main className="relay-owner-placeholder">
      <section className="relay-owner-placeholder__card">
        <span className="relay-owner-placeholder__icon"><RelayIcon size={30} /></span>
        <p>DIALOGUE ATLAS RELAY</p>
        <h1>{roomId ? "正在打开协作空间" : "从已核验图谱开始共创"}</h1>
        {roomId ? <>
          <p>{error ?? <>房间 <code>{roomId}</code> 已绑定到当前匿名房主身份。正在载入持久图谱与私有 Realtime 频道。</>}</p>
          {transientInviteUrl ? <button type="button" className="primary" onClick={() => void navigator.clipboard.writeText(transientInviteUrl)}>复制访客邀请链接</button> : null}
        </> : <>
          <p>{configured
            ? "打开一段已分析的真实对话，在论点星图中逐项批准节点与证据，再发布为团队可协作的公开投影。"
            : "当前构建未配置 Supabase / Relay Web。你仍可检查本地发布预览，但不会触发网络或创建房间。"}</p>
          <button type="button" onClick={() => setShare(true)} disabled={!configured}>发布当前图谱</button>
        </>}
      </section>
    </main>
  );
}
