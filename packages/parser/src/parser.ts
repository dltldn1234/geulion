import {
  createDiagnostic,
  type Diagnostic,
  type DiagnosticCode,
  type SourcePosition,
  type SourceSpan,
} from "@geulion/ast";
import { TokenKind, type IdentifierToken, type Token } from "@geulion/lexer";
import type {
  AssignmentNode,
  BinaryExpressionNode,
  BlockStatementNode,
  BooleanLiteralExpressionNode,
  BreakStatementNode,
  CallExpressionNode,
  CollectionTypeNode,
  ContinueStatementNode,
  DictionaryEntryNode,
  DictionaryExpressionNode,
  EmptyOptionExpressionNode,
  ExpressionNode,
  ExpressionStatementNode,
  FunctionDeclarationNode,
  GroupingExpressionNode,
  IdentifierExpressionNode,
  IdentifierName,
  IfStatementNode,
  IndexExpressionNode,
  IntegerLiteralExpressionNode,
  ListExpressionNode,
  ParameterNode,
  PrimitiveTypeNode,
  ProgramNode,
  RealLiteralExpressionNode,
  ReturnStatementNode,
  SomeExpressionNode,
  StatementNode,
  StringLiteralExpressionNode,
  TypeNode,
  UnaryExpressionNode,
  UnitLiteralExpressionNode,
  VariableDeclarationNode,
  WhileStatementNode,
} from "@geulion/ast";

export interface ParseSuccess {
  readonly success: true;
  readonly ast: ProgramNode;
  readonly diagnostics: readonly [];
}

export interface ParseFailure {
  readonly success: false;
  readonly diagnostics: readonly [Diagnostic];
}

export type ParseResult = ParseSuccess | ParseFailure;

interface InfixInfo {
  readonly operator: BinaryExpressionNode["operator"];
  readonly bindingPower: number;
  readonly associativity: "left" | "right" | "none";
}

class ParserFailure extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

function joinedSpan(first: SourceSpan, last: SourceSpan): SourceSpan {
  return Object.freeze({ start: first.start, end: last.end });
}

function emptySpan(): SourceSpan {
  const position: SourcePosition = Object.freeze({
    byteOffset: 0,
    codePointOffset: 0,
    utf16Offset: 0,
    line: 1,
    column: 1,
  });
  return Object.freeze({ start: position, end: position });
}

function ensureEof(tokens: readonly Token[]): readonly Token[] {
  if (tokens.at(-1)?.kind === TokenKind.EndOfFile) return tokens;
  const last = tokens.at(-1);
  const position = last?.span.end ?? emptySpan().end;
  const eof: Token = {
    kind: TokenKind.EndOfFile,
    rawLexeme: "",
    span: { start: position, end: position },
  };
  return [...tokens, eof];
}

function infixInfo(token: Token | undefined): InfixInfo | undefined {
  if (token === undefined) return undefined;
  switch (token.kind) {
    case TokenKind.Coalesce:
      return { operator: "??", bindingPower: 1, associativity: "right" };
    case TokenKind.Or:
      return { operator: "또는", bindingPower: 2, associativity: "left" };
    case TokenKind.And:
      return { operator: "그리고", bindingPower: 3, associativity: "left" };
    case TokenKind.EqualEqual:
      return { operator: "==", bindingPower: 4, associativity: "none" };
    case TokenKind.NotEqual:
      return { operator: "!=", bindingPower: 4, associativity: "none" };
    case TokenKind.Less:
      return { operator: "<", bindingPower: 5, associativity: "none" };
    case TokenKind.LessEqual:
      return { operator: "<=", bindingPower: 5, associativity: "none" };
    case TokenKind.Greater:
      return { operator: ">", bindingPower: 5, associativity: "none" };
    case TokenKind.GreaterEqual:
      return { operator: ">=", bindingPower: 5, associativity: "none" };
    case TokenKind.Plus:
      return { operator: "+", bindingPower: 6, associativity: "left" };
    case TokenKind.Minus:
      return { operator: "-", bindingPower: 6, associativity: "left" };
    case TokenKind.Star:
      return { operator: "*", bindingPower: 7, associativity: "left" };
    case TokenKind.Slash:
      return { operator: "/", bindingPower: 7, associativity: "left" };
    case TokenKind.Percent:
      return { operator: "%", bindingPower: 7, associativity: "left" };
    default:
      return undefined;
  }
}

function bindingPowerOf(operator: BinaryExpressionNode["operator"]): number {
  switch (operator) {
    case "??":
      return 1;
    case "또는":
      return 2;
    case "그리고":
      return 3;
    case "==":
    case "!=":
      return 4;
    case "<":
    case "<=":
    case ">":
    case ">=":
      return 5;
    case "+":
    case "-":
      return 6;
    case "*":
    case "/":
    case "%":
      return 7;
  }
}

class RecursiveDescentParser {
  readonly #tokens: readonly Token[];
  readonly #path: string;
  #index = 0;

  constructor(tokens: readonly Token[], path: string) {
    this.#tokens = ensureEof(tokens);
    this.#path = path;
  }

  parse(): ProgramNode {
    const functions: FunctionDeclarationNode[] = [];
    this.#skipSeparators();
    while (!this.#at(TokenKind.EndOfFile)) {
      if (!this.#at(TokenKind.Function)) {
        this.#fail(
          "GE1001",
          "프로그램 최상위에는 함수 선언만 올 수 있습니다.",
          "최상위 선언을 `함수 이름(...) -> 타입 { ... }` 형식으로 작성하세요.",
        );
      }
      functions.push(this.#parseFunctionDeclaration());
      if (!this.#at(TokenKind.EndOfFile) && !this.#skipSeparators()) {
        this.#fail(
          "GE1002",
          "최상위 함수 선언 사이에 문장 구분자가 필요합니다.",
          "함수 선언 사이에 줄바꿈 또는 `;`를 넣으세요.",
        );
      }
    }
    const eof = this.#current();
    const start = functions[0]?.span.start ?? eof.span.start;
    return { kind: "Program", functions, span: Object.freeze({ start, end: eof.span.end }) };
  }

  #parseFunctionDeclaration(): FunctionDeclarationNode {
    const start = this.#consume(TokenKind.Function, "`함수`가 필요합니다.");
    const name = this.#identifierName(this.#expectIdentifier("함수 이름이 필요합니다."));
    this.#expect(TokenKind.LeftParen, "함수 매개변수 목록에 `(`가 필요합니다.");
    this.#skipNewlines();

    const parameters: ParameterNode[] = [];
    if (!this.#at(TokenKind.RightParen)) {
      while (true) {
        parameters.push(this.#parseParameter());
        this.#skipNewlines();
        if (!this.#at(TokenKind.Comma)) break;
        this.#advance();
        this.#skipNewlines();
        if (this.#at(TokenKind.RightParen)) break;
      }
    }
    this.#expectClosing(TokenKind.RightParen, "함수 매개변수 목록이 닫히지 않았습니다.");

    if (this.#at(TokenKind.Newline) && this.#nextNonNewline()?.kind === TokenKind.Arrow) {
      this.#skipNewlines();
    }
    this.#expect(TokenKind.Arrow, "함수 반환형 앞에 `->`가 필요합니다.");
    this.#skipNewlines();
    const returnType = this.#parseType();
    this.#skipNewlines();
    const body = this.#parseBlock();

    return {
      kind: "FunctionDeclaration",
      name,
      parameters,
      returnType,
      body,
      span: joinedSpan(start.span, body.span),
    };
  }

  #parseParameter(): ParameterNode {
    const nameToken = this.#expectIdentifier("매개변수 이름이 필요합니다.");
    const name = this.#identifierName(nameToken);
    this.#expect(TokenKind.Colon, "매개변수 이름 뒤에 `:`가 필요합니다.");
    this.#skipNewlines();
    const type = this.#parseType();
    return { kind: "Parameter", name, type, span: joinedSpan(nameToken.span, type.span) };
  }

  #parseType(): TypeNode {
    const token = this.#current();
    switch (token.kind) {
      case TokenKind.IntegerType:
      case TokenKind.RealType:
      case TokenKind.StringType:
      case TokenKind.BooleanType:
      case TokenKind.UnitType: {
        this.#advance();
        const names = new Map([
          [TokenKind.IntegerType, "정수"],
          [TokenKind.RealType, "실수"],
          [TokenKind.StringType, "문자열"],
          [TokenKind.BooleanType, "불리언"],
          [TokenKind.UnitType, "없음"],
        ] as const);
        const node: PrimitiveTypeNode = {
          kind: "PrimitiveType",
          name: names.get(token.kind) ?? "없음",
          span: token.span,
        };
        return node;
      }
      case TokenKind.ListType:
      case TokenKind.DictionaryType:
      case TokenKind.OptionType: {
        this.#advance();
        const collection =
          token.kind === TokenKind.ListType
            ? "목록"
            : token.kind === TokenKind.DictionaryType
              ? "사전"
              : "선택";
        this.#expect(TokenKind.LeftBracket, `${collection} 타입에 ` + "`[`가 필요합니다.");
        this.#skipNewlines();
        const elementType = this.#parseType();
        this.#skipNewlines();
        const close = this.#expectClosing(
          TokenKind.RightBracket,
          `${collection} 타입이 닫히지 않았습니다.`,
        );
        const node: CollectionTypeNode = {
          kind: "CollectionType",
          collection,
          elementType,
          span: joinedSpan(token.span, close.span),
        };
        return node;
      }
      case TokenKind.LeftParen: {
        const open = this.#advance();
        this.#skipNewlines();
        const type = this.#parseType();
        this.#skipNewlines();
        const close = this.#expectClosing(
          TokenKind.RightParen,
          "괄호로 묶은 타입이 닫히지 않았습니다.",
        );
        return { ...type, span: joinedSpan(open.span, close.span) };
      }
      case TokenKind.EndOfFile:
        return this.#fail(
          "GE1002",
          "타입이 필요한 위치에서 입력이 끝났습니다.",
          "기본 타입 또는 컬렉션 타입을 작성하세요.",
        );
      default:
        return this.#fail(
          "GE1001",
          "타입 이름이 필요합니다.",
          "`정수`, `실수`, `문자열`, `불리언`, `없음`, `목록[T]`, `사전[T]`, `선택[T]` 중 하나를 사용하세요.",
        );
    }
  }

  #parseBlock(): BlockStatementNode {
    const open = this.#expect(TokenKind.LeftBrace, "본문에 `{`가 필요합니다.");
    this.#skipSeparators();
    const statements: StatementNode[] = [];

    while (!this.#at(TokenKind.RightBrace) && !this.#at(TokenKind.EndOfFile)) {
      statements.push(this.#parseStatement());
      if (this.#at(TokenKind.RightBrace)) break;
      if (!this.#skipSeparators()) {
        this.#fail(
          "GE1002",
          "문장 사이에 구분자가 필요합니다.",
          "한 줄에 여러 문장을 쓸 때는 `;`를 사용하고, 그 밖에는 줄을 나누세요.",
        );
      }
    }

    const close = this.#expectClosing(TokenKind.RightBrace, "블록이 `}`로 닫히지 않았습니다.");
    return { kind: "BlockStatement", statements, span: joinedSpan(open.span, close.span) };
  }

  #parseStatement(): StatementNode {
    switch (this.#current().kind) {
      case TokenKind.Constant:
      case TokenKind.Variable:
        return this.#parseVariableDeclaration();
      case TokenKind.If:
        return this.#parseIfStatement();
      case TokenKind.While:
        return this.#parseWhileStatement();
      case TokenKind.Return:
        return this.#parseReturnStatement();
      case TokenKind.Break: {
        const token = this.#advance();
        const node: BreakStatementNode = { kind: "BreakStatement", span: token.span };
        return node;
      }
      case TokenKind.Continue: {
        const token = this.#advance();
        const node: ContinueStatementNode = { kind: "ContinueStatement", span: token.span };
        return node;
      }
      case TokenKind.LeftBrace:
        return this.#parseBlock();
      case TokenKind.Identifier:
        if (this.#peek(1).kind === TokenKind.Assign) return this.#parseAssignment();
        if (this.#peek(1).kind === TokenKind.LeftParen) return this.#parseCallStatement();
        return this.#fail(
          "GE1001",
          "식별자로 시작하는 문장은 대입 또는 함수 호출이어야 합니다.",
          "대입은 `변수 = 식`으로, 호출문은 `함수이름(인자)`로 작성하세요.",
        );
      default:
        return this.#fail(
          "GE1001",
          "유효한 문장이 필요합니다.",
          "GEULION v0.1에 정의된 문장 형식을 사용하세요.",
        );
    }
  }

  #parseVariableDeclaration(): VariableDeclarationNode {
    const declaration = this.#advance();
    const nameToken = this.#expectIdentifier("변수 또는 상수 이름이 필요합니다.");
    const name = this.#identifierName(nameToken);
    let annotation: TypeNode | null = null;
    if (this.#at(TokenKind.Colon)) {
      this.#advance();
      this.#skipNewlines();
      annotation = this.#parseType();
    }
    this.#expect(TokenKind.Assign, "선언 초기화에 `=`가 필요합니다.");
    this.#skipNewlines();
    const initializer = this.#parseExpression();
    const node: VariableDeclarationNode = {
      kind: "VariableDeclaration",
      mutable: declaration.kind === TokenKind.Variable,
      name,
      annotation,
      initializer,
      span: joinedSpan(declaration.span, initializer.span),
    };
    return node;
  }

  #parseAssignment(): AssignmentNode {
    const token = this.#expectIdentifier("대입 대상 이름이 필요합니다.");
    const target = this.#identifierName(token);
    this.#expect(TokenKind.Assign, "대입 대상 뒤에 `=`가 필요합니다.");
    this.#skipNewlines();
    const value = this.#parseExpression();
    return { kind: "Assignment", target, value, span: joinedSpan(token.span, value.span) };
  }

  #parseCallStatement(): ExpressionStatementNode {
    const expression: CallExpressionNode = this.#parseCallExpression();
    return { kind: "ExpressionStatement", expression, span: expression.span };
  }

  #parseIfStatement(): IfStatementNode {
    const start = this.#consume(TokenKind.If, "`만약`이 필요합니다.");
    this.#skipNewlines();
    const condition = this.#parseExpression();
    this.#skipNewlines();
    const thenBranch = this.#parseBlock();
    if (this.#at(TokenKind.Newline) && this.#nextNonNewline()?.kind === TokenKind.Else) {
      this.#skipNewlines();
    }

    let elseBranch: BlockStatementNode | IfStatementNode | null = null;
    let endSpan = thenBranch.span;
    if (this.#at(TokenKind.Else)) {
      this.#advance();
      this.#skipNewlines();
      if (this.#at(TokenKind.If)) elseBranch = this.#parseIfStatement();
      else if (this.#at(TokenKind.LeftBrace)) elseBranch = this.#parseBlock();
      else {
        this.#fail(
          "GE1001",
          "`아니면` 뒤에 조건문 또는 블록이 필요합니다.",
          "`아니면 만약 조건 { ... }` 또는 `아니면 { ... }`를 사용하세요.",
        );
      }
      endSpan = elseBranch.span;
    }

    return {
      kind: "IfStatement",
      condition,
      thenBranch,
      elseBranch,
      span: joinedSpan(start.span, endSpan),
    };
  }

  #parseWhileStatement(): WhileStatementNode {
    const start = this.#consume(TokenKind.While, "`동안`이 필요합니다.");
    this.#skipNewlines();
    const condition = this.#parseExpression();
    this.#skipNewlines();
    const body = this.#parseBlock();
    return { kind: "WhileStatement", condition, body, span: joinedSpan(start.span, body.span) };
  }

  #parseReturnStatement(): ReturnStatementNode {
    const start = this.#consume(TokenKind.Return, "`반환`이 필요합니다.");
    if (
      this.#at(TokenKind.Newline) ||
      this.#at(TokenKind.Semicolon) ||
      this.#at(TokenKind.RightBrace) ||
      this.#at(TokenKind.EndOfFile)
    ) {
      return { kind: "ReturnStatement", value: null, span: start.span };
    }
    const value = this.#parseExpression();
    return { kind: "ReturnStatement", value, span: joinedSpan(start.span, value.span) };
  }

  #parseExpression(minimumBindingPower = 1): ExpressionNode {
    let left = this.#parsePrefixExpression();

    while (true) {
      if (this.#at(TokenKind.LeftBracket)) {
        this.#advance();
        this.#skipNewlines();
        const index = this.#parseExpression();
        this.#skipNewlines();
        const close = this.#expectClosing(
          TokenKind.RightBracket,
          "인덱스 표현식이 `]`로 닫히지 않았습니다.",
        );
        const node: IndexExpressionNode = {
          kind: "IndexExpression",
          target: left,
          index,
          span: joinedSpan(left.span, close.span),
        };
        left = node;
        continue;
      }

      const operator = infixInfo(this.#currentOrUndefined());
      if (operator === undefined || operator.bindingPower < minimumBindingPower) break;
      if (
        operator.associativity === "none" &&
        left.kind === "BinaryExpression" &&
        bindingPowerOf(left.operator) === operator.bindingPower
      ) {
        this.#fail(
          "GE1002",
          "비교 및 동등 연산자는 같은 식에서 연속해서 사용할 수 없습니다.",
          "연산을 괄호로 묶거나 하나의 비교만 사용하세요.",
        );
      }

      this.#advance();
      this.#skipNewlines();
      const nextMinimum =
        operator.associativity === "right" ? operator.bindingPower : operator.bindingPower + 1;
      const right = this.#parseExpression(nextMinimum);
      const node: BinaryExpressionNode = {
        kind: "BinaryExpression",
        operator: operator.operator,
        left,
        right,
        span: joinedSpan(left.span, right.span),
      };
      left = node;
    }

    return left;
  }

  #parsePrefixExpression(): ExpressionNode {
    const token = this.#current();
    if (
      token.kind === TokenKind.Not ||
      token.kind === TokenKind.Plus ||
      token.kind === TokenKind.Minus
    ) {
      this.#advance();
      this.#skipNewlines();
      const operand = this.#parseExpression(8);
      const operator: UnaryExpressionNode["operator"] =
        token.kind === TokenKind.Not ? "아니다" : token.kind === TokenKind.Plus ? "+" : "-";
      const node: UnaryExpressionNode = {
        kind: "UnaryExpression",
        operator,
        operand,
        span: joinedSpan(token.span, operand.span),
      };
      return node;
    }

    switch (token.kind) {
      case TokenKind.Identifier: {
        const identifier = token as IdentifierToken;
        if (this.#peek(1).kind === TokenKind.LeftParen) return this.#parseCallExpression();
        this.#advance();
        const name = this.#identifierName(identifier);
        const node: IdentifierExpressionNode = {
          kind: "IdentifierExpression",
          name,
          span: identifier.span,
        };
        return node;
      }
      case TokenKind.IntegerLiteral: {
        this.#advance();
        const node: IntegerLiteralExpressionNode = {
          kind: "IntegerLiteralExpression",
          raw: token.rawLexeme,
          span: token.span,
        };
        return node;
      }
      case TokenKind.RealLiteral: {
        this.#advance();
        const node: RealLiteralExpressionNode = {
          kind: "RealLiteralExpression",
          raw: token.rawLexeme,
          span: token.span,
        };
        return node;
      }
      case TokenKind.StringLiteral: {
        this.#advance();
        const node: StringLiteralExpressionNode = {
          kind: "StringLiteralExpression",
          value: token.value,
          span: token.span,
        };
        return node;
      }
      case TokenKind.True:
      case TokenKind.False: {
        this.#advance();
        const node: BooleanLiteralExpressionNode = {
          kind: "BooleanLiteralExpression",
          value: token.kind === TokenKind.True,
          span: token.span,
        };
        return node;
      }
      case TokenKind.UnitType: {
        this.#advance();
        const node: UnitLiteralExpressionNode = { kind: "UnitLiteralExpression", span: token.span };
        return node;
      }
      case TokenKind.None: {
        this.#advance();
        const node: EmptyOptionExpressionNode = { kind: "EmptyOptionExpression", span: token.span };
        return node;
      }
      case TokenKind.Some:
        return this.#parseSomeExpression();
      case TokenKind.LeftParen:
        return this.#parseGroupingExpression();
      case TokenKind.LeftBracket:
        return this.#parseListExpression();
      case TokenKind.LeftBrace:
        return this.#parseDictionaryExpression();
      case TokenKind.EndOfFile:
        return this.#fail(
          "GE1002",
          "표현식이 필요한 위치에서 입력이 끝났습니다.",
          "완전한 표현식을 작성하세요.",
        );
      default:
        return this.#fail(
          "GE1001",
          "이 위치에서 표현식을 시작할 수 없습니다.",
          "유효한 literal, 식별자, 괄호 또는 단항 연산자를 사용하세요.",
        );
    }
  }

  #parseGroupingExpression(): GroupingExpressionNode {
    const open = this.#advance();
    this.#skipNewlines();
    const expression = this.#parseExpression();
    this.#skipNewlines();
    const close = this.#expectClosing(
      TokenKind.RightParen,
      "괄호 표현식이 `)`로 닫히지 않았습니다.",
    );
    return { kind: "GroupingExpression", expression, span: joinedSpan(open.span, close.span) };
  }

  #parseSomeExpression(): SomeExpressionNode {
    const start = this.#consume(TokenKind.Some, "`일부`가 필요합니다.");
    this.#expect(TokenKind.LeftParen, "`일부` 뒤에 `(`가 필요합니다.");
    this.#skipNewlines();
    const value = this.#parseExpression();
    this.#skipNewlines();
    const close = this.#expectClosing(
      TokenKind.RightParen,
      "`일부` 표현식이 `)`로 닫히지 않았습니다.",
    );
    return { kind: "SomeExpression", value, span: joinedSpan(start.span, close.span) };
  }

  #parseListExpression(): ListExpressionNode {
    const open = this.#advance();
    this.#skipNewlines();
    const elements: ExpressionNode[] = [];
    if (!this.#at(TokenKind.RightBracket)) {
      while (true) {
        elements.push(this.#parseExpression());
        this.#skipNewlines();
        if (!this.#at(TokenKind.Comma)) break;
        this.#advance();
        this.#skipNewlines();
        if (this.#at(TokenKind.RightBracket)) break;
      }
    }
    const close = this.#expectClosing(
      TokenKind.RightBracket,
      "목록 리터럴이 `]`로 닫히지 않았습니다.",
    );
    return { kind: "ListExpression", elements, span: joinedSpan(open.span, close.span) };
  }

  #parseDictionaryExpression(): DictionaryExpressionNode {
    const open = this.#advance();
    this.#skipNewlines();
    const entries: DictionaryEntryNode[] = [];
    if (!this.#at(TokenKind.RightBrace)) {
      while (true) {
        const keyToken = this.#current();
        if (keyToken.kind !== TokenKind.StringLiteral) {
          this.#fail(
            "GE1001",
            "사전 리터럴의 key는 문자열 literal이어야 합니다.",
            "key를 큰따옴표 문자열로 작성하세요.",
          );
        }
        this.#advance();
        const key: StringLiteralExpressionNode = {
          kind: "StringLiteralExpression",
          value: keyToken.value,
          span: keyToken.span,
        };
        this.#expect(TokenKind.Colon, "사전 key 뒤에 `:`가 필요합니다.");
        this.#skipNewlines();
        const value = this.#parseExpression();
        const entry: DictionaryEntryNode = {
          kind: "DictionaryEntry",
          key,
          value,
          span: joinedSpan(key.span, value.span),
        };
        entries.push(entry);
        this.#skipNewlines();
        if (!this.#at(TokenKind.Comma)) break;
        this.#advance();
        this.#skipNewlines();
        if (this.#at(TokenKind.RightBrace)) break;
      }
    }

    if (!this.#at(TokenKind.RightBrace) && this.#current().kind !== TokenKind.EndOfFile) {
      this.#fail(
        "GE1002",
        "사전 항목은 쉼표로 구분해야 합니다.",
        "사전 항목 사이에 `,`를 넣으세요.",
      );
    }
    const close = this.#expectClosing(
      TokenKind.RightBrace,
      "사전 리터럴이 `}`로 닫히지 않았습니다.",
    );
    return { kind: "DictionaryExpression", entries, span: joinedSpan(open.span, close.span) };
  }

  #parseCallExpression(): CallExpressionNode {
    const nameToken = this.#expectIdentifier("함수 이름이 필요합니다.");
    const callee = this.#identifierName(nameToken);
    this.#expect(TokenKind.LeftParen, "함수 호출에 `(`가 필요합니다.");
    this.#skipNewlines();
    const args: ExpressionNode[] = [];
    if (!this.#at(TokenKind.RightParen)) {
      while (true) {
        args.push(this.#parseExpression());
        this.#skipNewlines();
        if (!this.#at(TokenKind.Comma)) break;
        this.#advance();
        this.#skipNewlines();
        if (this.#at(TokenKind.RightParen)) break;
      }
    }
    const close = this.#expectClosing(
      TokenKind.RightParen,
      "함수 호출 인자 목록이 `)`로 닫히지 않았습니다.",
    );
    return {
      kind: "CallExpression",
      callee,
      arguments: args,
      span: joinedSpan(nameToken.span, close.span),
    };
  }

  #identifierName(token: IdentifierToken): IdentifierName {
    return { raw: token.rawLexeme, normalized: token.normalizedName, span: token.span };
  }

  #expectIdentifier(message: string): IdentifierToken {
    const token = this.#current();
    if (token.kind !== TokenKind.Identifier) {
      const code: DiagnosticCode = token.kind === TokenKind.EndOfFile ? "GE1002" : "GE1001";
      this.#fail(code, message, "유효한 식별자 이름을 작성하세요.");
    }
    this.#advance();
    return token;
  }

  #expect(kind: Token["kind"], message: string): Token {
    const token = this.#current();
    if (token.kind !== kind) {
      const code: DiagnosticCode = token.kind === TokenKind.EndOfFile ? "GE1002" : "GE1001";
      this.#fail(code, message, `현재 구문에서 ${message}`);
    }
    return this.#advance();
  }

  #expectClosing(kind: Token["kind"], message: string): Token {
    const token = this.#current();
    if (token.kind !== kind) {
      const position = token.span.start;
      this.#fail(
        "GE1002",
        message,
        "열린 괄호, 대괄호 또는 블록 구분자가 닫혔는지 확인하세요.",
        Object.freeze({ start: position, end: position }),
      );
    }
    return this.#advance();
  }

  #consume(kind: Token["kind"], message: string): Token {
    if (!this.#at(kind)) {
      const token = this.#current();
      const code: DiagnosticCode = token.kind === TokenKind.EndOfFile ? "GE1002" : "GE1001";
      this.#fail(code, message, message);
    }
    return this.#advance();
  }

  #fail(
    code: DiagnosticCode,
    message: string,
    help: string,
    range: SourceSpan = this.#current().span,
  ): never {
    throw new ParserFailure(
      createDiagnostic({ code, phase: "parse", message, path: this.#path, range, help }),
    );
  }

  #current(): Token {
    return (
      this.#tokens[this.#index] ??
      this.#tokens.at(-1) ?? {
        kind: TokenKind.EndOfFile,
        rawLexeme: "",
        span: emptySpan(),
      }
    );
  }

  #currentOrUndefined(): Token | undefined {
    return this.#tokens[this.#index];
  }

  #peek(distance: number): Token {
    return this.#tokens[this.#index + distance] ?? this.#tokens.at(-1) ?? this.#current();
  }

  #advance(): Token {
    const token = this.#current();
    if (token.kind !== TokenKind.EndOfFile) this.#index += 1;
    return token;
  }

  #at(kind: Token["kind"]): boolean {
    return this.#current().kind === kind;
  }

  #skipNewlines(): boolean {
    let skipped = false;
    while (this.#at(TokenKind.Newline)) {
      this.#advance();
      skipped = true;
    }
    return skipped;
  }

  #skipSeparators(): boolean {
    let skipped = false;
    while (this.#at(TokenKind.Newline) || this.#at(TokenKind.Semicolon)) {
      this.#advance();
      skipped = true;
    }
    return skipped;
  }

  #nextNonNewline(): Token | undefined {
    let offset = this.#index;
    while (this.#tokens[offset]?.kind === TokenKind.Newline) offset += 1;
    return this.#tokens[offset];
  }
}

/** Parses a token stream that has already passed lexical analysis. */
export function parseTokens(tokens: readonly Token[], path = "<stdin>"): ParseResult {
  const parser = new RecursiveDescentParser(tokens, path);
  try {
    const ast = parser.parse();
    return { success: true, ast, diagnostics: [] };
  } catch (error) {
    if (error instanceof ParserFailure) {
      return { success: false, diagnostics: [error.diagnostic] };
    }
    throw error;
  }
}
