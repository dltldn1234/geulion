import { Buffer } from "node:buffer";
import type {
  BlockStatementNode,
  ExpressionNode,
  IdentifierName,
  SourceSpan,
  StatementNode,
} from "@geulion/ast";
import type { TypedProgram } from "@geulion/semantic";
import { createRuntime } from "./runtime.js";

export interface GeneratedSourceMapping {
  readonly generatedLine: number;
  readonly generatedColumn: number;
  readonly source: SourceSpan;
}

export interface JavaScriptSourceMap {
  readonly version: 3;
  readonly file: string;
  readonly sources: readonly string[];
  readonly sourcesContent: readonly (string | null)[];
  readonly names: readonly string[];
  readonly mappings: string;
}

const base64Digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function quoted(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
function vlq(value: number): string {
  let bits = value < 0 ? (-value << 1) | 1 : value << 1;
  let result = "";
  do {
    let digit = bits & 31;
    bits >>>= 5;
    if (bits > 0) digit |= 32;
    result += base64Digits[digit];
  } while (bits > 0);
  return result;
}

export function generateJavaScript(
  program: TypedProgram,
  options: { readonly sourceText?: string; readonly fileName?: string } = {},
) {
  if (program.checked !== true) throw new Error("Code generation requires a checked typed program");
  const lines: string[] = [];
  const mappings: GeneratedSourceMapping[] = [];
  let indent = 0;
  function line(text: string, source?: SourceSpan) {
    for (const part of text.split("\n")) {
      if (source)
        mappings.push({ generatedLine: lines.length + 1, generatedColumn: indent * 2, source });
      lines.push(`${"  ".repeat(indent)}${part}`);
    }
  }
  function symbolId(name: IdentifierName): number {
    const id = program.references.get(name);
    if (id === undefined) throw new Error("Missing resolved symbol in checked program");
    return id;
  }
  function span(source: SourceSpan): string {
    return JSON.stringify(source);
  }
  function expression(node: ExpressionNode): string {
    const type = program.expressionTypes.get(node);
    if (!type || type.kind === "error")
      throw new Error("Missing expression type in checked program");
    switch (node.kind) {
      case "IntegerLiteralExpression":
        return `${BigInt(node.raw)}n`;
      case "RealLiteralExpression":
        return String(Number(node.raw));
      case "StringLiteralExpression":
        return quoted(node.value);
      case "BooleanLiteralExpression":
        return String(node.value);
      case "UnitLiteralExpression":
        return "_g.unit";
      case "EmptyOptionExpression":
        return "_g.none";
      case "IdentifierExpression":
        return `_g_v${symbolId(node.name)}`;
      case "GroupingExpression":
        return `(${expression(node.expression)})`;
      case "SomeExpression":
        return `_g.some(${expression(node.value)})`;
      case "ListExpression":
        return `_g.list([${node.elements.map(expression).join(", ")}])`;
      case "DictionaryExpression":
        return `_g.dictionary([${node.entries.map((entry) => `[${quoted(entry.key.value)}, ${expression(entry.value)}]`).join(", ")}])`;
      case "IndexExpression":
        return `_g.index(${expression(node.target)}, ${expression(node.index)})`;
      case "CallExpression": {
        const id = symbolId(node.callee);
        const symbol = program.symbols.get(id);
        if (!symbol || (symbol.kind !== "function" && symbol.kind !== "prelude"))
          throw new Error("Invalid checked call symbol");
        const args = node.arguments.map(expression).join(", ");
        if (symbol.kind === "function") return `_g_f${id}(${args})`;
        switch (symbol.name) {
          case "출력":
            return `_g.output(${args}, ${span(node.span)})`;
          case "정수로":
            return `_g.toInteger(${args}, ${span(node.span)})`;
          case "실수로":
            return `_g.toReal(${args})`;
          default:
            throw new Error("Unknown prelude symbol");
        }
      }
      case "UnaryExpression": {
        if (program.signedMinimumLiterals.has(node)) return "(-9223372036854775808n)";
        const operand = expression(node.operand);
        if (node.operator === "아니다") return `(!${operand})`;
        if (type.kind === "primitive" && type.name === "정수")
          return node.operator === "+"
            ? `(${operand})`
            : `_g.negateInteger(${operand}, ${span(node.span)})`;
        return `(${node.operator}${operand})`;
      }
      case "BinaryExpression": {
        const left = expression(node.left);
        const right = expression(node.right);
        if (node.operator === "??") return `_g.coalesce(${left}, () => ${right})`;
        if (node.operator === "==" || node.operator === "!=")
          return `${node.operator === "!=" ? "!" : ""}_g.equal(${left}, ${right})`;
        if (node.operator === "그리고" || node.operator === "또는")
          return `(${left} ${node.operator === "그리고" ? "&&" : "||"} ${right})`;
        const operandType = program.expressionTypes.get(node.left);
        if (
          operandType?.kind === "primitive" &&
          operandType.name === "정수" &&
          ["+", "-", "*", "/", "%"].includes(node.operator)
        )
          return `_g.integerBinary(${JSON.stringify(node.operator)}, ${left}, ${right}, ${span(node.span)})`;
        return `(${left} ${node.operator} ${right})`;
      }
    }
  }
  function block(node: BlockStatementNode) {
    line("{", node.span);
    indent++;
    node.statements.forEach(statement);
    indent--;
    line("}");
  }
  function statement(node: StatementNode): void {
    switch (node.kind) {
      case "VariableDeclaration":
        line(
          `${node.mutable ? "let" : "const"} _g_v${symbolId(node.name)} = ${expression(node.initializer)};`,
          node.span,
        );
        return;
      case "Assignment":
        line(`_g_v${symbolId(node.target)} = ${expression(node.value)};`, node.span);
        return;
      case "ExpressionStatement":
        line(`${expression(node.expression)};`, node.span);
        return;
      case "ReturnStatement":
        line(`return ${node.value ? expression(node.value) : "_g.unit"};`, node.span);
        return;
      case "BreakStatement":
        line("break;", node.span);
        return;
      case "ContinueStatement":
        line("continue;", node.span);
        return;
      case "BlockStatement":
        block(node);
        return;
      case "IfStatement":
        line(`if (${expression(node.condition)})`, node.span);
        block(node.thenBranch);
        if (node.elseBranch) {
          line("else");
          statement(node.elseBranch);
        }
        return;
      case "WhileStatement":
        line(`while (${expression(node.condition)})`, node.span);
        block(node.body);
        return;
    }
  }

  line('import { writeSync as _g_writeSync } from "node:fs";');
  line(`const _g_source = ${quoted(options.sourceText?.replace(/^\uFEFF/, "") ?? "")};`);
  line(`function _g_write(fd, text) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  while (offset < bytes.length) {
    const written = _g_writeSync(fd, bytes, offset, bytes.length - offset);
    if (written === 0) throw new Error("Standard output made no progress");
    offset += written;
  }
}`);
  line(`const _g = (${createRuntime.toString()})({
  write(text) { _g_write(1, text); },
  report(d) {
    let text = "오류 [" + d.code + "]: " + d.message + "\\n";
    if (d.path !== null && d.range !== null) {
      const p = d.range.start;
      text += "  " + d.path + ":" + p.line + ":" + p.column + "\\n";
      const sourceLine = _g_source.split(/\\r\\n|\\r|\\n/)[p.line - 1];
      if (sourceLine !== undefined && _g_source.length > 0) {
        const width = d.range.end.line === p.line ? Math.max(1, d.range.end.column - p.column) : 1;
        text += sourceLine + "\\n" + " ".repeat(p.column - 1) + "^".repeat(width) + "\\n";
      }
    }
    if (d.help !== null) text += "도움말: " + d.help + "\\n";
    _g_write(2, text);
  }
}, ${quoted(program.path)});`);
  for (const fn of program.ast.functions) {
    const id = symbolId(fn.name);
    line(
      `function _g_f${id}(${fn.parameters.map((p) => `_g_v${symbolId(p.name)}`).join(", ")}) {`,
      fn.span,
    );
    indent++;
    fn.body.statements.forEach(statement);
    if (fn.returnType.kind === "PrimitiveType" && fn.returnType.name === "없음")
      line("return _g.unit;");
    indent--;
    line("}");
  }
  line(
    `process.exitCode = _g.run(_g_f${program.entrypoint.id});`,
    program.entrypoint.span ?? program.ast.span,
  );

  let priorLine = 0;
  let priorColumn = 0;
  const segments = new Map(mappings.map((mapping) => [mapping.generatedLine, mapping]));
  const encoded = lines
    .map((_, i) => {
      const mapping = segments.get(i + 1);
      if (!mapping) return "";
      const originalLine = mapping.source.start.line - 1;
      const originalColumn = mapping.source.start.column - 1;
      const segment =
        vlq(mapping.generatedColumn) +
        vlq(0) +
        vlq(originalLine - priorLine) +
        vlq(originalColumn - priorColumn);
      priorLine = originalLine;
      priorColumn = originalColumn;
      return segment;
    })
    .join(";");
  const sourceMap: JavaScriptSourceMap = {
    version: 3,
    file: options.fileName ?? "output.mjs",
    sources: [program.path],
    sourcesContent: [options.sourceText ?? null],
    names: [],
    mappings: encoded,
  };
  lines.push(
    `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(sourceMap)).toString("base64")}`,
  );
  return { code: `${lines.join("\n")}\n`, sourceMap, mappings };
}
