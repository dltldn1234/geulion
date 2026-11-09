# GEULION Language Server

`@geulion/language-server` is a standalone Language Server Protocol 3.17 server for `.geul` files. It communicates over standard input and output using Content-Length framed JSON-RPC. Standard output is reserved for protocol messages; diagnostics from server failures go to standard error.

## Build and launch

From the GEULION repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/language-server/dist/server.js
```

The package also exposes the `geulion-language-server` executable when installed by a workspace-aware package manager. Start one process per client connection and attach its standard input and output to the LSP transport.

## Capabilities

- UTF-8, UTF-16, and UTF-32 positions negotiated from the client's LSP capabilities; UTF-16 is the default when no encoding list is provided
- Full document synchronization, versioned open/change/close notifications, and compiler diagnostics
- Keyword, built-in, and in-file function completion
- Built-in signature help, semantic hover, function definition, and document symbols
- Semantic references and rename edits checked by the GEULION compiler before being returned
- Cancellation for requests still queued for dispatch, stale document version rejection, and malformed JSON frame recovery

Language version defaults to `0.1`. Clients can select `0.1`, `0.2`, or `0.3` with `initializationOptions.languageVersion`, then update it with `workspace/didChangeConfiguration` using `settings.geulion.languageVersion`.

The server reuses `@geulion/compiler` analysis and diagnostics. Cross-file modules, workspace indexing, and resolving definitions from other documents are not implemented.

Requests are handled synchronously against the current document snapshot. Since no analysis work continues asynchronously after a request completes, later edits cannot publish an older result; cancellation applies while a request is queued and has not started.
