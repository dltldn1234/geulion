# GEULION Language Support for VS Code

This local extension package registers `.geul` files with the `geulion` language ID and provides a TextMate grammar, bracket/comment editing rules, starter snippets, and light/dark file icons. Its grammar follows the reserved words and lexical forms in `docs/language/lexical-structure.md` and the existing lexer keyword table.

## Open the Extension Development Host

From the repository root, open this folder as a development extension and a GEULION source file:

```sh
code --new-window --extensionDevelopmentPath="$PWD/packages/vscode" examples/idle/game.geul
```

The package currently provides editor language support only. Run/check commands and Language Server features are tracked as later Phase 8 work. Do not publish this extension to the Marketplace from this package.

## Validation

The repository test suite checks the extension manifest references, lexer keyword coverage, comment/bracket rules, and starter snippets:

```sh
pnpm test
```
