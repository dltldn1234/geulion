import type { SourceSpan } from "./source.js";

export interface IdentifierName {
  readonly raw: string;
  readonly normalized: string;
  readonly span: SourceSpan;
}

export interface ProgramNode {
  readonly kind: "Program";
  readonly functions: readonly FunctionDeclarationNode[];
  readonly span: SourceSpan;
}

export interface FunctionDeclarationNode {
  readonly kind: "FunctionDeclaration";
  readonly name: IdentifierName;
  readonly parameters: readonly ParameterNode[];
  readonly returnType: TypeNode;
  readonly body: BlockStatementNode;
  readonly span: SourceSpan;
}

export interface ParameterNode {
  readonly kind: "Parameter";
  readonly name: IdentifierName;
  readonly type: TypeNode;
  readonly span: SourceSpan;
}

export type PrimitiveTypeName = "정수" | "실수" | "문자열" | "불리언" | "없음";

export interface PrimitiveTypeNode {
  readonly kind: "PrimitiveType";
  readonly name: PrimitiveTypeName;
  readonly span: SourceSpan;
}

export interface CollectionTypeNode {
  readonly kind: "CollectionType";
  readonly collection: "목록" | "사전" | "선택";
  readonly elementType: TypeNode;
  readonly span: SourceSpan;
}

export type TypeNode = PrimitiveTypeNode | CollectionTypeNode;

export interface BlockStatementNode {
  readonly kind: "BlockStatement";
  readonly statements: readonly StatementNode[];
  readonly span: SourceSpan;
}

export interface VariableDeclarationNode {
  readonly kind: "VariableDeclaration";
  readonly mutable: boolean;
  readonly name: IdentifierName;
  readonly annotation: TypeNode | null;
  readonly initializer: ExpressionNode;
  readonly span: SourceSpan;
}

export interface AssignmentNode {
  readonly kind: "Assignment";
  readonly target: IdentifierName;
  readonly value: ExpressionNode;
  readonly span: SourceSpan;
}

export interface IfStatementNode {
  readonly kind: "IfStatement";
  readonly condition: ExpressionNode;
  readonly thenBranch: BlockStatementNode;
  readonly elseBranch: BlockStatementNode | IfStatementNode | null;
  readonly span: SourceSpan;
}

export interface WhileStatementNode {
  readonly kind: "WhileStatement";
  readonly condition: ExpressionNode;
  readonly body: BlockStatementNode;
  readonly span: SourceSpan;
}

export interface ReturnStatementNode {
  readonly kind: "ReturnStatement";
  readonly value: ExpressionNode | null;
  readonly span: SourceSpan;
}

export interface BreakStatementNode {
  readonly kind: "BreakStatement";
  readonly span: SourceSpan;
}

export interface ContinueStatementNode {
  readonly kind: "ContinueStatement";
  readonly span: SourceSpan;
}

export interface ExpressionStatementNode {
  readonly kind: "ExpressionStatement";
  readonly expression: CallExpressionNode;
  readonly span: SourceSpan;
}

export type StatementNode =
  | VariableDeclarationNode
  | AssignmentNode
  | IfStatementNode
  | WhileStatementNode
  | ReturnStatementNode
  | BreakStatementNode
  | ContinueStatementNode
  | BlockStatementNode
  | ExpressionStatementNode;

export interface IdentifierExpressionNode {
  readonly kind: "IdentifierExpression";
  readonly name: IdentifierName;
  readonly span: SourceSpan;
}

export interface IntegerLiteralExpressionNode {
  readonly kind: "IntegerLiteralExpression";
  readonly raw: string;
  readonly span: SourceSpan;
}

export interface RealLiteralExpressionNode {
  readonly kind: "RealLiteralExpression";
  readonly raw: string;
  readonly span: SourceSpan;
}

export interface StringLiteralExpressionNode {
  readonly kind: "StringLiteralExpression";
  readonly value: string;
  readonly span: SourceSpan;
}

export interface BooleanLiteralExpressionNode {
  readonly kind: "BooleanLiteralExpression";
  readonly value: boolean;
  readonly span: SourceSpan;
}

export interface UnitLiteralExpressionNode {
  readonly kind: "UnitLiteralExpression";
  readonly span: SourceSpan;
}

export interface EmptyOptionExpressionNode {
  readonly kind: "EmptyOptionExpression";
  readonly span: SourceSpan;
}

export interface GroupingExpressionNode {
  readonly kind: "GroupingExpression";
  readonly expression: ExpressionNode;
  readonly span: SourceSpan;
}

export interface UnaryExpressionNode {
  readonly kind: "UnaryExpression";
  readonly operator: "아니다" | "+" | "-";
  readonly operand: ExpressionNode;
  readonly span: SourceSpan;
}

export interface BinaryExpressionNode {
  readonly kind: "BinaryExpression";
  readonly operator:
    "??" | "또는" | "그리고" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/" | "%";
  readonly left: ExpressionNode;
  readonly right: ExpressionNode;
  readonly span: SourceSpan;
}

export interface CallExpressionNode {
  readonly kind: "CallExpression";
  readonly callee: IdentifierName;
  readonly arguments: readonly ExpressionNode[];
  readonly span: SourceSpan;
}

export interface IndexExpressionNode {
  readonly kind: "IndexExpression";
  readonly target: ExpressionNode;
  readonly index: ExpressionNode;
  readonly span: SourceSpan;
}

export interface ListExpressionNode {
  readonly kind: "ListExpression";
  readonly elements: readonly ExpressionNode[];
  readonly span: SourceSpan;
}

export interface DictionaryEntryNode {
  readonly kind: "DictionaryEntry";
  readonly key: StringLiteralExpressionNode;
  readonly value: ExpressionNode;
  readonly span: SourceSpan;
}

export interface DictionaryExpressionNode {
  readonly kind: "DictionaryExpression";
  readonly entries: readonly DictionaryEntryNode[];
  readonly span: SourceSpan;
}

export interface SomeExpressionNode {
  readonly kind: "SomeExpression";
  readonly value: ExpressionNode;
  readonly span: SourceSpan;
}

export type ExpressionNode =
  | IdentifierExpressionNode
  | IntegerLiteralExpressionNode
  | RealLiteralExpressionNode
  | StringLiteralExpressionNode
  | BooleanLiteralExpressionNode
  | UnitLiteralExpressionNode
  | EmptyOptionExpressionNode
  | GroupingExpressionNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | CallExpressionNode
  | IndexExpressionNode
  | ListExpressionNode
  | DictionaryExpressionNode
  | SomeExpressionNode;

export type AstNode =
  | ProgramNode
  | FunctionDeclarationNode
  | ParameterNode
  | TypeNode
  | StatementNode
  | ExpressionNode
  | DictionaryEntryNode;

export type AstVisitor = (node: AstNode) => void;

/** Visits each node in source/structural order without requiring inheritance. */
export function visitAst(node: AstNode, visitor: AstVisitor): void {
  visitor(node);
  switch (node.kind) {
    case "Program":
      node.functions.forEach((child) => visitAst(child, visitor));
      return;
    case "FunctionDeclaration":
      node.parameters.forEach((child) => visitAst(child, visitor));
      visitAst(node.returnType, visitor);
      visitAst(node.body, visitor);
      return;
    case "Parameter":
      visitAst(node.type, visitor);
      return;
    case "PrimitiveType":
      return;
    case "CollectionType":
      visitAst(node.elementType, visitor);
      return;
    case "BlockStatement":
      node.statements.forEach((child) => visitAst(child, visitor));
      return;
    case "VariableDeclaration":
      if (node.annotation !== null) visitAst(node.annotation, visitor);
      visitAst(node.initializer, visitor);
      return;
    case "Assignment":
      visitAst(node.value, visitor);
      return;
    case "IfStatement":
      visitAst(node.condition, visitor);
      visitAst(node.thenBranch, visitor);
      if (node.elseBranch !== null) visitAst(node.elseBranch, visitor);
      return;
    case "WhileStatement":
      visitAst(node.condition, visitor);
      visitAst(node.body, visitor);
      return;
    case "ReturnStatement":
      if (node.value !== null) visitAst(node.value, visitor);
      return;
    case "BreakStatement":
    case "ContinueStatement":
      return;
    case "ExpressionStatement":
      visitAst(node.expression, visitor);
      return;
    case "IdentifierExpression":
    case "IntegerLiteralExpression":
    case "RealLiteralExpression":
    case "StringLiteralExpression":
    case "BooleanLiteralExpression":
    case "UnitLiteralExpression":
    case "EmptyOptionExpression":
      return;
    case "GroupingExpression":
      visitAst(node.expression, visitor);
      return;
    case "UnaryExpression":
      visitAst(node.operand, visitor);
      return;
    case "BinaryExpression":
      visitAst(node.left, visitor);
      visitAst(node.right, visitor);
      return;
    case "CallExpression":
      node.arguments.forEach((child) => visitAst(child, visitor));
      return;
    case "IndexExpression":
      visitAst(node.target, visitor);
      visitAst(node.index, visitor);
      return;
    case "ListExpression":
      node.elements.forEach((child) => visitAst(child, visitor));
      return;
    case "DictionaryExpression":
      node.entries.forEach((child) => visitAst(child, visitor));
      return;
    case "DictionaryEntry":
      visitAst(node.key, visitor);
      visitAst(node.value, visitor);
      return;
    case "SomeExpression":
      visitAst(node.value, visitor);
      return;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}
