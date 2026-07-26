import { describe, expect, test } from "bun:test"
import { createRoom, fetchServiceStatus, NetworkError, pauseMessage } from "../src/client/net"
import { partyFailureText } from "../src/client/party-link"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/** Relative fetch targets resolve against a dummy origin so a Request can be built. */
function toRequest(input: string | URL | Request, init?: RequestInit): Request {
  if (typeof input === "string" || input instanceof URL) {
    return new Request(new URL(input.toString(), "http://test.local"), init)
  }
  return init === undefined ? input : new Request(input, init)
}

/** Builds a real `fetch`-shaped stub around a Request handler - no casts. */
function stubFetch(handler: (req: Request) => Response | Promise<Response>): typeof fetch {
  const impl = async (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
    const [input, init] = args
    return handler(toRequest(input, init))
  }
  // Bun's fetch carries a custom `preconnect`; the stub re-exports the real one.
  return Object.assign(impl, { preconnect: fetch.preconnect })
}

function failingFetch(error: unknown): typeof fetch {
  return stubFetch(() => Promise.reject(error))
}

describe("pauseMessage", () => {
  test("slices the day out of a valid ISO timestamp", () => {
    expect(pauseMessage("2026-08-01T00:00:00.000Z")).toContain("2026-08-01")
  })

  test("falls back to next month for null", () => {
    expect(pauseMessage(null)).toContain("next month")
  })

  test("falls back to next month for unparseable input", () => {
    expect(pauseMessage("garbage")).toContain("next month")
  })
})

describe("fetchServiceStatus", () => {
  test("passes through a valid paused status", async () => {
    const fetcher = stubFetch(async () =>
      jsonResponse(200, { paused: true, resetsAt: "2026-08-01T00:00:00Z" }),
    )
    const status = await fetchServiceStatus(fetcher)
    expect(status).toEqual({ paused: true, resetsAt: "2026-08-01T00:00:00Z" })
  })

  test("fails open on a malformed payload", async () => {
    const fetcher = stubFetch(async () => jsonResponse(200, { paused: "yes" }))
    await expect(fetchServiceStatus(fetcher)).resolves.toEqual({
      paused: false,
      resetsAt: null,
    })
  })

  test("fails open when the fetcher rejects", async () => {
    await expect(fetchServiceStatus(failingFetch(new Error("offline")))).resolves.toEqual({
      paused: false,
      resetsAt: null,
    })
  })

  test("fails open on a non-2xx response", async () => {
    const fetcher = stubFetch(async () => jsonResponse(500, { paused: true, resetsAt: null }))
    await expect(fetchServiceStatus(fetcher)).resolves.toEqual({
      paused: false,
      resetsAt: null,
    })
  })
})

describe("createRoom", () => {
  test("returns the room code on success", async () => {
    const fetcher = stubFetch(async () => jsonResponse(200, { code: "ABCD" }))
    await expect(createRoom(fetcher)).resolves.toBe("ABCD")
  })

  test("throws a budget-pause NetworkError carrying the reset day", async () => {
    const fetcher = stubFetch(async () =>
      jsonResponse(503, {
        error: {
          code: "service_paused",
          message: "budget breaker tripped",
          resetsAt: "2026-08-01T00:00:00Z",
        },
      }),
    )
    try {
      await createRoom(fetcher)
      expect.unreachable("createRoom should throw")
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error
      expect(error.message).toContain("2026-08-01")
    }
  })

  test("throws the generic HTTP error when the 503 body is unreadable", async () => {
    const fetcher = stubFetch(async () => new Response("not json", { status: 503 }))
    try {
      await createRoom(fetcher)
      expect.unreachable("createRoom should throw")
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error
      expect(error.message).toContain("HTTP 503")
    }
  })
})

describe("partyFailureText", () => {
  test("passes a service_paused message through verbatim", () => {
    expect(partyFailureText("service_paused", "Multiplayer is paused")).toBe(
      "Multiplayer is paused",
    )
  })

  test("prefixes any other error code", () => {
    expect(partyFailureText("room_full", "Room is full")).toBe("room_full: Room is full")
  })
})
