import { describe, expect, test } from "bun:test"
import { createRoom, fetchServiceStatus, NetworkError, pauseMessage } from "../src/client/net"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function stubFetch(impl: () => Promise<Response>): typeof fetch {
  return impl as unknown as typeof fetch
}

function failingFetch(error: unknown): typeof fetch {
  return (() => Promise.reject(error)) as unknown as typeof fetch
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
      expect(error).toBeInstanceOf(NetworkError)
      expect((error as Error).message).toContain("2026-08-01")
    }
  })

  test("throws the generic HTTP error when the 503 body is unreadable", async () => {
    const fetcher = stubFetch(async () => new Response("not json", { status: 503 }))
    try {
      await createRoom(fetcher)
      expect.unreachable("createRoom should throw")
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkError)
      expect((error as Error).message).toContain("HTTP 503")
    }
  })
})
