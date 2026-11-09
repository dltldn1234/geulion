# GEULION Language Support for VS Code

This local extension package registers `.geul` files with the `geulion` language ID and provides a TextMate grammar, bracket/comment editing rules, starter snippets, and light/dark file icons. Its grammar follows the reserved words and lexical forms in `docs/language/lexical-structure.md` and the existing lexer keyword table.

## Open the Extension Development Host

From the repository root, open this folder as a development extension and a GEULION source file:

```sh
code --new-window --extensionDevelopmentPath="$PWD/packages/vscode" examples/idle/game.geul
```

The extension provides two command-palette actions: `GEULION: 현재 파일 검사` and `GEULION: 현재 파일 실행`. Set `geulion.executable` to the CLI executable; when using this repository's workspace CLI, `geulion.executable` can be `pnpm` and `geulion.arguments` can be `["exec", "geulion"]`. `geulion.languageVersion` selects 0.1, 0.2, or 0.3. The current CLI can check v0.3 programs but cannot run them yet. Commands pass arguments without a shell and stream results to the `GEULION` Output Channel.

Open and edited `.geul` files receive compiler diagnostics after a short debounce. The extension sends the in-memory document text to `geulion check - --format json`, so unsaved edits are checked without writing temporary source files. Diagnostics are cleared when a document closes; results from superseded checks are ignored.

Completion suggestions include the lexer keywords and core built-ins. String helper signatures appear only for language versions 0.2 and 0.3. The `공개 함수` declaration suggestion appears only for v0.3 because `공개` is a contextual modifier rather than a reserved word.

Signature help is available while calling core built-ins and the version-enabled string helpers. It tracks nested delimiters and ignores commas inside strings and comments when selecting the active parameter.

Hover shows short Korean descriptions for core keywords and built-ins. v0.2 string helpers and the contextual v0.3 `공개` modifier follow the selected language version; identifiers that are not part of the built-in vocabulary receive no generated documentation.

Language Server features remain later Phase 8 work. Do not publish this extension to the Marketplace from this package.

## Validation

The repository test suite checks the extension manifest references, lexer keyword coverage, comment/bracket rules, and starter snippets:

```sh
pnpm test
```
