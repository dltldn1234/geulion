import type { PrimitiveTypeName, TypeNode } from "@geulion/ast";

export type GeulType =
  | { readonly kind: "primitive"; readonly name: PrimitiveTypeName }
  | {
      readonly kind: "collection";
      readonly name: "목록" | "사전" | "선택";
      readonly element: GeulType;
    }
  | { readonly kind: "error" };

export const INTEGER: GeulType = { kind: "primitive", name: "정수" };
export const REAL: GeulType = { kind: "primitive", name: "실수" };
export const STRING: GeulType = { kind: "primitive", name: "문자열" };
export const BOOLEAN: GeulType = { kind: "primitive", name: "불리언" };
export const UNIT: GeulType = { kind: "primitive", name: "없음" };
export const ERROR: GeulType = { kind: "error" };

export function collection(name: "목록" | "사전" | "선택", element: GeulType): GeulType {
  return element.kind === "error" ? ERROR : { kind: "collection", name, element };
}

export function typeFromNode(node: TypeNode): GeulType {
  return node.kind === "PrimitiveType"
    ? { kind: "primitive", name: node.name }
    : collection(node.collection, typeFromNode(node.elementType));
}

export function sameType(a: GeulType, b: GeulType): boolean {
  if (a.kind === "error" || b.kind === "error") return true;
  if (a.kind === "primitive" && b.kind === "primitive") return a.name === b.name;
  return (
    a.kind === "collection" &&
    b.kind === "collection" &&
    a.name === b.name &&
    sameType(a.element, b.element)
  );
}

export function typeName(type: GeulType): string {
  if (type.kind === "error") return "오류 타입";
  return type.kind === "primitive" ? type.name : `${type.name}[${typeName(type.element)}]`;
}
