import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "coverage/**",
      "examples/idle/generated/**",
      "vscode-user-data/**",
      "vscode-extensions/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
);
