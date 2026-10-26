import * as ast from "@geulion/ast";
import * as cli from "@geulion/cli";
import * as codegen from "@geulion/codegen-js";
import * as compiler from "@geulion/compiler";
import * as lexer from "@geulion/lexer";
import * as parser from "@geulion/parser";
import * as semantic from "@geulion/semantic";
import { describe, expect, it } from "vitest";

describe("workspace package entrypoints", () => {
  it("imports every compiler package as an ES module", () => {
    const modules = [ast, lexer, parser, semantic, compiler, codegen, cli];

    expect(modules).toHaveLength(7);
    for (const module of modules) {
      expect(module).toBeDefined();
    }
  });
});
