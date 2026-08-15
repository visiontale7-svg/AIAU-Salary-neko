import { RelayRoom } from "./RelayRoom";
import {
  useRelayRoomController,
  type RelayRoomControllerOptions,
} from "./useRelayRoomController";

export type RelayRoomRuntimeProps = RelayRoomControllerOptions;

/** Shared host runtime with transport injection and no Tauri or router dependency. */
export function RelayRoomRuntime(props: RelayRoomRuntimeProps) {
  const controller = useRelayRoomController(props);
  return <RelayRoom model={controller.model} callbacks={controller.callbacks} />;
}
