# Local computer-use service

`service.ts` is a separate local process started for each computer MCP session. It owns the stdio connection to `cua-driver`, checks every action with the server's control endpoint, records saved-step calls when requested, and normalizes driver responses. The process exits when the MCP session ends.

`local-computer.ts` validates the driver connection that Electron grants to its own server and creates the service launch descriptor. `guidance.ts`, `effect.ts`, and `unconfirmed-click.ts` implement local computer-specific behavior inside that process. The small files under `server/` with the old names are import adapters for the existing server callers.

Electron remains responsible for starting the native driver daemon. On macOS, the driver's permission attribution depends on Electron being its responsible process. The server receives a connection only through Electron's private parent port, and the service receives a control token only through its environment when the server launches it. No local network listener is exposed by this service.
