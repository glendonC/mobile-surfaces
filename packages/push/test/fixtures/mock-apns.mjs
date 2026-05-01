// In-process h2c (cleartext HTTP/2) APNs stand-in. Each test composes its
// own handler that inspects the request and writes a response. The server
// listens on 127.0.0.1:<random>; the test passes the resulting `origin` into
// the PushClient via TEST_TRANSPORT_OVERRIDE.

import http2 from "node:http2";

export function startMockApns(handler) {
  return new Promise((resolve, reject) => {
    const server = http2.createServer();
    const requests = [];
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
        close: () =>
          new Promise((res) => {
            server.close(() => res());
            // Force-close any lingering sessions so the process exits.
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
  const { status = 200, headers = {}, body, destroy } = resp;
  if (destroy) {
    stream.session?.destroy(new Error("forced close"));
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
