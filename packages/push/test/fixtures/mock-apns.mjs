// In-process h2c (cleartext HTTP/2) APNs stand-in. Each test composes its
// own handler that inspects the request and writes a response. The server
// listens on 127.0.0.1:<random>; the test passes the resulting `origin` into
// the PushClient via TEST_TRANSPORT_OVERRIDE.

import http2 from "node:http2";

export function startMockApns(handler) {
  return new Promise((resolve, reject) => {
    const server = http2.createServer();
    const requests = [];
    // Track each accepted h2 session so tests can verify reconnect behavior
    // (one new session after a GOAWAY) versus connection reuse (one session
    // for many parallel streams).
    const sessions = [];
    server.on("session", (session) => {
      sessions.push(session);
    });
    server.on("stream", (stream, headers) => {
      const reqInfo = {
        path: String(headers[":path"]),
        method: String(headers[":method"]),
        headers,
        body: "",
      };
      stream.on("data", (chunk) => {
        reqInfo.body += chunk.toString("utf8");
      });
      stream.on("end", () => {
        requests.push(reqInfo);
        try {
          const result = handler(reqInfo, requests.length - 1);
          Promise.resolve(result).then(
            (resp) => writeResponse(stream, resp),
            (err) => {
              try {
                stream.respond({ ":status": 500 });
                stream.end(String(err?.message ?? err));
              } catch {
                stream.close();
              }
            },
          );
        } catch (err) {
          try {
            stream.respond({ ":status": 500 });
            stream.end(String(err?.message ?? err));
          } catch {
            stream.close();
          }
        }
      });
      stream.on("error", () => {
        // The test sometimes injects a forced socket destroy; swallow.
      });
    });
    server.on("error", (err) => reject(err));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const origin = `http://127.0.0.1:${port}`;
      resolve({
        origin,
        server,
        requests,
        get sessionCount() {
          return sessions.length;
        },
        // Forcefully destroy the most recent h2 session so the SDK has to
        // dial a fresh one on the next request. Mirrors APNs sending GOAWAY
        // then closing the socket: the SDK's `goaway` and `close` listeners
        // both drop the cached session.
        destroySession() {
          const last = sessions[sessions.length - 1];
          if (!last || last.destroyed) return;
          try {
            last.destroy();
          } catch {
            // session may already be closing; ignore.
          }
        },
        close: () =>
          new Promise((res) => {
            // Forcibly destroy any sessions still attached to the server so
            // server.close() can resolve quickly even if a test left a
            // session in a half-closed state. Without this, idle/destroy
            // tests can hang teardown waiting on graceful close.
            for (const session of sessions) {
              if (!session.destroyed) {
                try {
                  session.destroy();
                } catch {
                  // ignore
                }
              }
            }
            server.close(() => res());
            server.unref?.();
          }),
      });
    });
  });
}

function writeResponse(stream, resp) {
  if (!resp) {
    stream.respond({ ":status": 200 });
    stream.end();
    return;
  }
  const { status = 200, headers = {}, body, destroy, rstStream } = resp;
  if (destroy) {
    stream.session?.destroy(new Error("forced close"));
    return;
  }
  // Per-stream reset, leaving the session alive. Mirrors APNs / a proxy
  // sending RST_STREAM on a single in-flight request. Defaults to
  // REFUSED_STREAM (NGHTTP2_REFUSED_STREAM, in the SDK's retryable transport
  // codes); pass `{ rstStream: <code> }` to use a different code.
  if (rstStream) {
    const code = typeof rstStream === "number"
      ? rstStream
      : 0x07; // NGHTTP2_REFUSED_STREAM
    try {
      stream.close(code);
    } catch {
      // stream may already be closing; ignore.
    }
    return;
  }
  const responseHeaders = { ":status": status, ...headers };
  stream.respond(responseHeaders);
  if (body !== undefined) {
    stream.end(typeof body === "string" ? body : JSON.stringify(body));
  } else {
    stream.end();
  }
}
