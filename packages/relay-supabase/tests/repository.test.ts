import { describe, expect, it } from "vitest";
import type { SupabaseClientLike, SupabaseResult } from "../src/client-like";
import { RelaySupabaseRepository } from "../src/repository";

function result(data: unknown): Promise<SupabaseResult<unknown>> {
  return Promise.resolve({ data, error: null });
}

describe("Relay Supabase repository RPC mapping", () => {
  it("loads the room projection and activity watermark from one atomic RPC", async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const client = {
      rpc(name: string, args?: Record<string, unknown>) {
        calls.push({ name, args });
        return result({
          room: {
            id: "room-1",
            title: "Atomic room",
            owner_id: "owner-1",
            status: "open",
            current_version_id: "version-1",
            revision: 3,
          },
          member: {
            room_id: "room-1",
            user_id: "member-1",
            display_name: "Durable member",
            role: "member",
            color_key: "member-1",
          },
          members: [
            {
              room_id: "room-1",
              user_id: "owner-1",
              display_name: "Durable owner",
              role: "owner",
              color_key: "member-0",
            },
            {
              room_id: "room-1",
              user_id: "member-1",
              display_name: "Durable member",
              role: "member",
              color_key: "member-1",
            },
          ],
          atlas: {
            schemaVersion: "relay-v1",
            graph: { layout: { n001: { x: 12, y: 34 } } },
          },
          layout: [],
          teamItems: [],
          stances: [],
          proposals: [],
          comments: [],
          decisions: [],
          actionBriefs: [],
          devinRuns: [],
          lastActivitySeq: 41,
        });
      },
      from() {
        throw new Error("fetchRoom must not fan out across table snapshots");
      },
    } as unknown as SupabaseClientLike;

    const bundle = await new RelaySupabaseRepository(client).fetchRoom("room-1");
    expect(calls).toEqual([{ name: "get_room_bundle", args: { p_room_id: "room-1" } }]);
    expect(bundle.lastActivitySeq).toBe(41);
    expect(bundle.member.colorKey).toBe("member-1");
    expect(bundle.members).toEqual([
      { roomId: "room-1", userId: "owner-1", displayName: "Durable owner", role: "owner", colorKey: "member-0" },
      { roomId: "room-1", userId: "member-1", displayName: "Durable member", role: "member", colorKey: "member-1" },
    ]);
    expect(bundle.layout).toEqual([{
      roomId: "room-1",
      nodeId: "n001",
      x: 12,
      y: 34,
      revision: 0,
      updatedBy: "owner-1",
    }]);
  });

  it("uses the locked room and comment RPC signatures", async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const client = {
      rpc(name: string, args?: Record<string, unknown>) {
        calls.push({ name, args });
        if (name === "create_room_with_package") {
          return result({ roomId: "room-1", inviteToken: "secret-token" });
        }
        return result({
          value: {
            id: "comment-1",
            roomId: "room-1",
            proposalId: "proposal-1",
            body: "Evidence please",
            createdBy: "user-1",
            createdAt: "2026-08-15T00:00:00Z",
            clientMutationId: "mutation-1",
          },
          activitySeq: 12,
        });
      },
    } as unknown as SupabaseClientLike;
    const repository = new RelaySupabaseRepository(client);
    await repository.createRoomWithPackage({ schemaVersion: "relay-v1" } as never, { maxUses: 3 });
    await repository.appendProposalComment({
      roomId: "room-1",
      proposalId: "proposal-1",
      body: "Evidence please",
      clientMutationId: "mutation-1",
    });

    expect(calls).toEqual([
      {
        name: "create_room_with_package",
        args: { p_package: { schemaVersion: "relay-v1" }, p_invite_config: { maxUses: 3 } },
      },
      {
        name: "append_proposal_comment",
        args: {
          p_input: { roomId: "room-1", proposalId: "proposal-1", body: "Evidence please" },
          p_client_mutation_id: "mutation-1",
        },
      },
    ]);
  });

  it("exposes the owner room-close RPC without a racing client revision read", async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const client = {
      rpc(name: string, args?: Record<string, unknown>) {
        calls.push({ name, args });
        return result({ roomId: "room-1", revision: 9, activitySeq: 55 });
      },
    } as unknown as SupabaseClientLike;
    const repository = new RelaySupabaseRepository(client);
    await expect(repository.closeRoom("room-1")).resolves.toEqual({ activitySeq: 55 });
    expect(calls).toEqual([{ name: "close_room", args: { p_room_id: "room-1" } }]);
  });

  it("routes Devin operations only through the Edge Function", async () => {
    const calls: Array<{ name: string; body: Record<string, unknown> }> = [];
    const run = {
      id: "run-1",
      roomId: "room-1",
      actionBriefId: "brief-1",
      state: "not_configured",
      providerHealth: "unknown",
      consecutiveFailures: 0,
      updatedAt: "2026-08-15T00:00:00Z",
    };
    const client = {
      functions: {
        invoke(name: string, options: { body: Record<string, unknown> }) {
          calls.push({ name, body: options.body });
          return result({ ok: true, run });
        },
      },
    } as unknown as SupabaseClientLike;
    const repository = new RelaySupabaseRepository(client);
    expect(await repository.createDevinRun({
      roomId: "room-1",
      actionBriefId: "brief-1",
      clientRequestId: "request-1",
    })).toEqual(run);
    expect(await repository.sendDevinMessage({
      roomId: "room-1",
      runId: "run-1",
      message: "Please rerun the tests",
      clientRequestId: "request-2",
    })).toEqual(run);
    expect(await repository.refreshDevinRun({ roomId: "room-1", runId: "run-1" })).toEqual(run);
    expect(calls).toEqual([
      {
        name: "devin-relay",
        body: {
          operation: "start",
          roomId: "room-1",
          actionBriefId: "brief-1",
          requestId: "request-1",
        },
      },
      {
        name: "devin-relay",
        body: {
          operation: "follow_up",
          roomId: "room-1",
          runId: "run-1",
          message: "Please rerun the tests",
          requestId: "request-2",
        },
      },
      {
        name: "devin-relay",
        body: {
          operation: "status",
          roomId: "room-1",
          runId: "run-1",
        },
      },
    ]);
  });

  it("forwards caller-owned stance idempotency keys unchanged", async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const client = {
      rpc(name: string, args?: Record<string, unknown>) {
        calls.push({ name, args });
        return result({
          value: {
            roomId: "room-1",
            nodeId: "n001",
            userId: "user-1",
            stance: "confirm",
            updatedAt: "2026-08-15T00:00:00Z",
          },
          activitySeq: 4,
        });
      },
    } as unknown as SupabaseClientLike;
    const repository = new RelaySupabaseRepository(client);
    await repository.setNodeStance({
      roomId: "room-1",
      nodeId: "n001",
      stance: "confirm",
      clientMutationId: "stance-request-001",
    });
    expect(calls).toEqual([{
      name: "set_node_stance",
      args: {
        p_input: {
          roomId: "room-1",
          nodeId: "n001",
          stance: "confirm",
          clientMutationId: "stance-request-001",
        },
      },
    }]);
  });
});
