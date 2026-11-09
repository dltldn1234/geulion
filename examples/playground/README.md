# GEULION Web Playground

The playground compiles GEULION v0.3 source with the repository's browser compiler target. It runs the generated module in a disposable Web Worker and exposes only the generated module's host output channel and public-function ABI.

## Run locally

From the repository root, build the workspace and start a static HTTP server:

```sh
pnpm build
python3 -m http.server 8000
```

Open <http://localhost:8000/examples/playground/>. The import map points at the workspace packages' generated `dist` files, so run the build again after changing compiler packages.

## Browser boundary

The page uses a strict Content Security Policy and makes no external requests. A Worker has no DOM access; it is terminated after two seconds, when source changes, and when the page is closed. The compiler's browser ABI validates host values and does not expose browser APIs. This is a practical execution boundary, not a complete security guarantee against browser or compiler vulnerabilities. Do not use it to run programs from untrusted sources as a substitute for a hardened operating-system sandbox.

Share links put source in the URL fragment, which browsers do not send as part of the HTTP request. Shared source is limited to 24 KiB; editor source is limited to 256 KiB. The page does not publish or deploy the playground.
