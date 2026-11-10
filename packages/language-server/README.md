# GEULION Language Server

`@geulion/language-server` is a standalone Language Server Protocol 3.17 server for `.geul` files. It communicates over standard input and output using Content-Length framed JSON-RPC. Standard output is reserved for protocol messages; diagnostics from server failures go to standard error.

## Build and launch

From the GEULION repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/language-server/dist/server.js
```

## Focused subprocess coverage

Run `pnpm test:coverage:language-server` from the repository root to build the server and execute its stdio integration suite under Node V8 coverage. The tests launch the server as a child process, which c8 collects along with the test runner. The report includes the compiled server entry point and uses its source map to report TypeScript coverage for `src/server.ts`; it prints a text summary and writes machine-readable JSON under the ignored `coverage/language-server/` directory. This focused report is diagnostic and does not enforce a global percentage threshold.

The package also exposes the `geulion-language-server` executable when installed by a workspace-aware package manager. Start one process per client connection and attach its standard input and output to the LSP transport.

## Capabilities

- UTF-8, UTF-16, and UTF-32 positions negotiated from the client's LSP capabilities; UTF-16 is the default when no encoding list is provided
- Full document synchronization, versioned open/change/close notifications, and compiler diagnostics
- v0.4 project-wide diagnostics for reachable import graphs, with open buffers taking precedence and dependent module diagnostics refreshed after edits, close, and workspace changes
- Keyword, built-in, and in-file function completion
- Built-in signature help, semantic hover, function definition, semantic document highlights, document symbols, and function folding ranges
- LSP quick fixes for recognized compiler guidance: a sole top-level function without `시작` can be renamed to the required entrypoint; ambiguous programs and all other diagnostic hints remain informational
- Full and incremental semantic tokens for keywords, strings, numbers, operators, punctuation, and comments, encoded for the negotiated position format; delta snapshots are capped at four per open document
- Workspace symbol search across `.geul` files under the negotiated workspace folders (or `rootUri`), with open buffers taking precedence
- Definition and references can navigate to a uniquely named top-level function declaration in another workspace file when the call is otherwise unresolved in the active file; this is editor navigation only, not cross-file compilation or an import/module system
- Semantic references and rename edits checked by the GEULION compiler before being returned
- Cancellation for requests still queued for dispatch, stale document version rejection, and malformed JSON frame recovery

Transport input is bounded to 8 KiB of headers and 16 MiB of body data. Each frame must contain exactly one non-negative decimal `Content-Length` header. Invalid or oversized headers terminate the connection because the next frame boundary cannot be determined safely. Malformed UTF-8 or JSON bodies return a JSON-RPC parse error and the next length-delimited frame is still processed. EOF in a partial header or body is reported on standard error and exits unsuccessfully. Standard output remains reserved for framed JSON-RPC messages.

Language version defaults to `0.1`. Clients can select `0.1`, `0.2`, `0.3`, or `0.4` with `initializationOptions.languageVersion`, then update it with `workspace/didChangeConfiguration` using `settings.geulion.languageVersion`.

In v0.4, the server uses the deepest workspace folder containing the document as the project root; without a workspace folder, it uses the document's directory. It resolves diagnostics from entry modules that declare `함수 시작`, follows only reachable imports inside the root, and never follows symlinks. Open buffers override disk files for the same path. A library document without a reachable project entry receives parser diagnostics while it is edited, and project semantic diagnostics appear when a root entry imports it.

Workspace symbol search parses top-level function declarations in `.geul` files under the workspace roots, including syntactically valid modules that do not contain the program entry function. Overlapping workspace roots are supported, and a file discovered through more than one root contributes symbols only once. It reads disk contents for each search, so file additions, edits, and deletions do not remain stale; an open editor buffer overrides disk contents for the same file. The scan skips `.git`, `node_modules`, `dist`, and `coverage` directories and does not follow symlinks. Without a file workspace root, results come only from open documents. Search does not resolve cross-file references. The server uses the GEULION compiler frontend parser for symbols and compiler analysis for diagnostics and semantic editor features.

For v0.1–v0.3, cross-file definition and reference lookup is an editor aid for a call whose name has exactly one top-level function declaration across the current workspace. Duplicate declarations are treated as ambiguous and produce no cross-file target. v0.4 diagnostics use explicit import aliases, public visibility, and project type checking; import-aware definition and rename navigation are a separate follow-up.

Requests are handled synchronously against the current document snapshot. Since no analysis work continues asynchronously after a request completes, later edits cannot publish an older result; cancellation applies while a request is queued and has not started.
