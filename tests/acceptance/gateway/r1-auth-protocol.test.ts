/**
 * Release 1: Authentication & Protocol — OpenClaw Gateway
 *
 * Gateway Protocol v3 connect handshake, identity resolution, DCR auto-registration,
 * protocol frame parsing, and connection state machine.
 *
 * Aligned with real Gateway Protocol v3 spec:
 * - connect.challenge sent immediately on WS open
 * - Single-frame connect with device identity + signed nonce
 * - hello-ok response with protocol version, policy, device token
 *
 * DEPENDENCIES (enable in order):
 * - R1-1: connect.challenge sent on WS open (no prerequisites)
 * - R1-2: Full connect handshake with new device (requires R1-1)
 * - R1-3: Known device resolves existing identity (requires R1-2 — DCR must work first)
 * - R1-4: New device auto-registers via DCR (requires R1-2)
 * - R1-5: Frame dispatch to handler (requires R1-2 — auth must work)
 * - R1-6: Malformed frame error (no auth needed, can enable after R1-1)
 * - R1-7: State transitions (requires R1-2)
 * - R1-8: Method before auth rejected (requires R1-1)
 * - R1-9: Double connect rejected (requires R1-2)
 *
 * Driving port: WebSocket at /api/gateway
 * Scenarios: R1-1 through R1-9
 *
 * All scenarios @skip until walking skeleton passes.
 */
import { describe, expect, it } from "bun:test";
import { setupAcceptanceSuite } from "../acceptance-test-kit";
import { connectGateway } from "./gateway-test-kit";

const getRuntime = setupAcceptanceSuite("gateway-r1-auth");

/** Generate an Ed25519 key pair and sign a nonce. Returns connect params. */
async function createDeviceAuth(nonce: string) {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const publicKeyRaw = await crypto.subtle.exportKey(
    "raw",
    keyPair.publicKey,
  );
  const publicKeyBase64 = Buffer.from(publicKeyRaw).toString("base64");

  const nonceBytes = Buffer.from(nonce, "base64");
  const signature = await crypto.subtle.sign(
    "Ed25519",
    keyPair.privateKey,
    nonceBytes,
  );
  const signatureBase64 = Buffer.from(signature).toString("base64");

  return {
    publicKeyBase64,
    signatureBase64,
    deviceId: `dev-${crypto.randomUUID().slice(0, 8)}`,
  };
}

/** Build a full connect params object for the Gateway Protocol v3 handshake. */
function buildConnectParams(device: {
  publicKeyBase64: string;
  signatureBase64: string;
  deviceId: string;
  nonce: string;
}) {
  return {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: crypto.randomUUID(),
      version: "1.0.0-test",
      platform: "macos",
      mode: "remote",
    },
    role: "operator",
    scopes: ["operator.read", "operator.write"],
    auth: { token: "test-gateway-token" },
    device: {
      id: device.deviceId,
      publicKey: device.publicKeyBase64,
      signature: device.signatureBase64,
      signedAt: Date.now(),
      nonce: device.nonce,
    },
  };
}

describe("Gateway R1: Authentication & Protocol", () => {
  // R1-1: connect.challenge sent immediately on WS open (AC-1.1)
  // Enable first — this is the foundation for all auth tests.
  it("R1-1: connect.challenge event sent immediately on WebSocket open", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGateway(baseUrl);

    // Gateway MUST send connect.challenge within 1 second of WS open
    const challenge = await client.waitForEvent("connect.challenge", 1_000);
    expect(challenge.payload).toBeDefined();

    const { nonce, ts } = challenge.payload as { nonce: string; ts: number };
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);
    // Timestamp should be recent (within 5 seconds)
    expect(Math.abs(Date.now() - ts)).toBeLessThan(5_000);

    client.close();
  });

  // R1-2: Full Gateway Protocol v3 connect handshake (AC-1.1)
  // New device connects, signs challenge nonce, receives hello-ok.
  it("R1-2: Gateway Protocol v3 connect handshake succeeds", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGateway(baseUrl);

    // Wait for connect.challenge
    const challenge = await client.waitForEvent("connect.challenge", 5_000);
    const { nonce } = challenge.payload as { nonce: string; ts: number };

    // Generate Ed25519 key pair and sign the nonce
    const deviceAuth = await createDeviceAuth(nonce);

    // Send single-frame connect with full device identity
    const connectRes = await client.request(
      "connect",
      buildConnectParams({ ...deviceAuth, nonce }),
    );

    expect(connectRes.ok).toBe(true);
    const payload = connectRes.payload as {
      type: string;
      protocol: number;
      policy: { tickIntervalMs: number };
      auth: { deviceToken: string; role: string; scopes: string[] };
    };
    expect(payload.type).toBe("hello-ok");
    expect(payload.protocol).toBe(3);
    expect(payload.policy.tickIntervalMs).toBeGreaterThan(0);
    expect(typeof payload.auth.deviceToken).toBe("string");
    expect(payload.auth.role).toBe("operator");

    client.close();
  });

  // R1-3: Known device resolves Brain identity (AC-1.2)
  // Pre-register a device, then connect with same key pair.
  it.skip("R1-3: known device resolves Brain identity and workspace", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Pre-register a device in the agent table
    // (create agent + identity + identity_agent + member_of)
    const fingerprint = `dev-${crypto.randomUUID().slice(0, 8)}`;

    // ... seed device in DB with known fingerprint and public key ...

    const client = await connectGateway(baseUrl);

    // Wait for challenge, perform full connect handshake with known device key
    const challenge = await client.waitForEvent("connect.challenge", 5_000);
    const { nonce } = challenge.payload as { nonce: string };

    // ... sign with the pre-registered device's key pair ...
    // const connectRes = await client.request("connect", buildConnectParams({...}));

    // Verify identity and workspace are resolved in hello-ok
    // expect(connectRes.ok).toBe(true);
    // const payload = connectRes.payload as { workspace: string; identity: string };
    // expect(payload.workspace).toBeDefined();
    // expect(payload.identity).toBeDefined();

    client.close();
  });

  // R1-4: New device auto-registers via DCR (AC-1.3)
  it.skip("R1-4: new device auto-registers via DCR", async () => {
    const { baseUrl, surreal } = getRuntime();
    const client = await connectGateway(baseUrl);

    // Wait for challenge
    const challenge = await client.waitForEvent("connect.challenge", 5_000);
    const { nonce } = challenge.payload as { nonce: string };

    // Generate fresh Ed25519 key pair (unknown to Brain)
    const deviceAuth = await createDeviceAuth(nonce);
    const connectRes = await client.request(
      "connect",
      buildConnectParams({ ...deviceAuth, nonce }),
    );

    // Verify: hello-ok includes deviceToken
    expect(connectRes.ok).toBe(true);

    // Verify: agent record created in DB with device_fingerprint
    // const agents = await surreal.query<[{device_fingerprint: string}[]]>(
    //   "SELECT device_fingerprint FROM agent WHERE device_fingerprint = $fp",
    //   { fp: expectedFingerprint }
    // );
    // expect(agents[0].length).toBe(1);

    // Verify: identity created with identity_agent edge
    // Verify: member_of edge to default workspace

    client.close();
  });

  // R1-5: Valid request frame dispatches to handler (AC-1.4)
  it.skip("R1-5: valid request frame dispatches to correct handler", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGateway(baseUrl);

    // Complete auth handshake first
    // ... auth flow ...

    // After auth, send a valid sessions.list request
    // const res = await client.request("sessions.list", { status: "all" });
    // expect(res.ok).toBe(true);

    client.close();
  });

  // R1-6: Malformed frame returns invalid_frame error (AC-1.4)
  it("R1-6: malformed frame returns invalid_frame error", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGateway(baseUrl);

    // Wait for connect.challenge so we know the connection is fully established
    await client.waitForEvent("connect.challenge", 5_000);

    // Send malformed JSON
    client.sendRaw("not json at all");

    // Send frame missing required 'type' field
    client.sendRaw(JSON.stringify({ id: "test", method: "agent" }));

    // Send frame missing required 'id' field
    client.sendRaw(JSON.stringify({ type: "req", method: "agent" }));

    // Wait briefly for the server to process all three frames and send error responses
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Connection should still be open (protocol error, not fatal)
    expect(client.isOpen()).toBe(true);

    // Verify we received invalid_frame error responses for all three malformed frames
    const errorFrames = client.receivedFrames.filter(
      (f) => f.type === "res" && !f.ok && f.error.code === "invalid_frame",
    );
    expect(errorFrames.length).toBeGreaterThanOrEqual(3);

    client.close();
  });

  // R1-7: State machine transitions (AC-1.5)
  it.skip("R1-7: connection transitions connecting → authenticating → active", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGateway(baseUrl);

    // Initial state: connecting (challenge sent immediately)
    // Send connect with device identity → state: authenticating → active
    // hello-ok received → state: active
    // Close → state: closed

    client.close();
  });

  // R1-8: Method before auth returns not_authenticated (AC-1.5)
  it("R1-8: sending agent method before auth returns not_authenticated", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGateway(baseUrl);

    // Wait for connect.challenge so the connection is in "authenticating" state
    await client.waitForEvent("connect.challenge", 5_000);

    // Send agent method without authenticating first
    const res = await client.request("agent", { task: "test" });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("not_authenticated");
    }

    // Connection should still be open
    expect(client.isOpen()).toBe(true);

    client.close();
  });

  // R1-9: Double connect returns already_authenticated (AC-1.5)
  it("R1-9: sending connect while active returns already_authenticated", async () => {
    const { baseUrl } = getRuntime();
    const client = await connectGateway(baseUrl);

    // Complete full auth flow — wait for challenge, sign nonce, send connect
    const challenge = await client.waitForEvent("connect.challenge", 5_000);
    const { nonce } = challenge.payload as { nonce: string };
    const deviceAuth = await createDeviceAuth(nonce);
    const firstConnect = await client.request(
      "connect",
      buildConnectParams({ ...deviceAuth, nonce }),
    );
    expect(firstConnect.ok).toBe(true);

    // Try to connect again — should get already_authenticated
    const res = await client.request("connect", {
      minProtocol: 3,
      maxProtocol: 3,
      client: { id: "test", version: "1.0", platform: "test", mode: "remote" },
      role: "operator",
      scopes: [],
      auth: { token: "test" },
      device: {
        id: "x",
        publicKey: "x",
        signature: "x",
        signedAt: 0,
        nonce: "x",
      },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("already_authenticated");
    }

    // Connection should still be open
    expect(client.isOpen()).toBe(true);

    client.close();
  });
});
