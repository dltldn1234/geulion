import { describe, expect, it } from "vitest";
import { SourceFile, visitAst, type ProgramNode } from "@geulion/ast";
import { TokenKind } from "@geulion/lexer";

describe("AST and token infrastructure", () => {
  it("visits a typed AST in structural order", () => {
    const source = SourceFile.fromText("empty.geul", "");
    const span = source.span(0, 0);
    const program: ProgramNode = { kind: "Program", functions: [], span };
    const visited: string[] = [];

    visitAst(program, (node) => visited.push(node.kind));

    expect(visited).toEqual(["Program"]);
    expect(program.span).toEqual(span);
  });

  it("distinguishes keyword tokens from ordinary identifiers", () => {
    expect(TokenKind.Function).toBe("함수");
    expect(TokenKind.Identifier).toBe("Identifier");
    expect(TokenKind.EndOfFile).toBe("EndOfFile");
  });
});
