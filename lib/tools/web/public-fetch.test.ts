import { describe, expect, test } from "vitest";
import { isPublicIp, publicFetch, resolvePublic } from "./public-fetch";

describe("isPublicIp", () => {
  test("public addresses pass", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.215.14", "2606:4700:4700::1111", "2a00:1450:4007:80b::200e", "64:ff9b::808:808", "2002:0808:0808::1"]) {
      expect(isPublicIp(ip), ip).toBe(true);
    }
  });

  test("private, loopback, link-local and shared IPv4 are refused", () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0"]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });

  test("benchmarking, documentation, multicast, reserved and broadcast are refused", () => {
    for (const ip of ["198.18.0.1", "198.19.255.254", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255", "192.0.2.1", "198.51.100.7", "203.0.113.9", "192.0.0.8"]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });

  test("IPv6: loopback, unspecified, ULA, link-local, multicast, documentation, Teredo", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "ff02::1", "2001:db8::1", "2001:0:4136:e378::1", "fec0::1", "100::1"]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });

  test("IPv6 forms that carry a private IPv4", () => {
    for (const ip of ["::ffff:127.0.0.1", "::ffff:7f00:1", "::127.0.0.1", "::7f00:1", "64:ff9b::7f00:1", "64:ff9b::127.0.0.1", "64:ff9b::a00:1", "64:ff9b:1::1", "2002:7f00:1::1", "2002:c0a8:0101::1", "[::1]"]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });

  test("anything unreadable is refused", () => {
    for (const ip of ["", "localhost", "1.2.3", "::g", "1:2:3:4:5:6:7:8:9"]) expect(isPublicIp(ip), ip).toBe(false);
  });
});

describe("resolvePublic", () => {
  test("refuses loopback names and literals without a DNS query", async () => {
    for (const u of ["http://localhost/", "http://localhost./", "http://app.localhost:3777/", "http://127.0.0.1:3777/api/x", "http://[::1]:3777/", "http://[::127.0.0.1]/", "http://[64:ff9b::7f00:1]/", "http://2130706433/", "http://0x7f.1/", "http://198.18.0.1/"]) {
      await expect(resolvePublic(new URL(u)), u).rejects.toThrow(/Local or private address refused/);
    }
  });
  test("refuses other schemes; a WebSocket check takes ws(s) only", async () => {
    await expect(resolvePublic(new URL("file:///etc/passwd"))).rejects.toThrow(/Only http and https/);
    await expect(resolvePublic(new URL("http://8.8.8.8/"), { websocket: true })).rejects.toThrow(/Only ws and wss/);
    await expect(resolvePublic(new URL("ws://127.0.0.1:3777/"), { websocket: true })).rejects.toThrow(/Local or private/);
    expect(await resolvePublic(new URL("wss://8.8.8.8/"), { websocket: true })).toEqual([{ address: "8.8.8.8", family: 4 }]);
  });
});

describe("publicFetch", () => {
  test("never connects to the app's own API", async () => {
    await expect(publicFetch("http://127.0.0.1:3777/api/user-plugins/u-x/approve", { method: "POST", maxBytes: 1000 })).rejects.toThrow(/Local or private/);
  });
  test("a refused hop stops before any connection", async () => {
    const seen: string[] = [];
    await expect(
      publicFetch("http://8.8.8.8/", {
        maxBytes: 1000,
        beforeHop: (u) => {
          seen.push(u.hostname);
          throw new Error("not allowed");
        },
      }),
    ).rejects.toThrow("not allowed");
    expect(seen).toEqual(["8.8.8.8"]);
  });
});
