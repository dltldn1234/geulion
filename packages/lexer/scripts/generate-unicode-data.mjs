#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const [ucdArgument, outputArgument] = process.argv.slice(2);
if (!ucdArgument || !outputArgument) {
  process.stderr.write(
    "Usage: node packages/lexer/scripts/generate-unicode-data.mjs <Unicode-18.0.0-ucd-dir> <output.ts>\n",
  );
  process.exit(2);
}

const ucdDirectory = resolve(ucdArgument);
const outputPath = resolve(outputArgument);

function parseRange(text) {
  const [startText, endText = startText] = text.trim().split("..");
  return [Number.parseInt(startText, 16), Number.parseInt(endText, 16)];
}

function propertyRanges(fileName, property) {
  const ranges = [];
  for (const line of readFileSync(resolve(ucdDirectory, fileName), "utf8").split(/\r?\n/u)) {
    const content = line.split("#", 1)[0]?.trim();
    if (!content) continue;
    const fields = content.split(";").map((field) => field.trim());
    if (fields[1] === property) ranges.push(parseRange(fields[0]));
  }
  return mergeRanges(ranges);
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const [start, end] of sorted) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function fullCompositionExclusions() {
  const ranges = [];
  for (const line of readFileSync(
    resolve(ucdDirectory, "DerivedNormalizationProps.txt"),
    "utf8",
  ).split(/\r?\n/u)) {
    const content = line.split("#", 1)[0]?.trim();
    if (!content) continue;
    const fields = content.split(";").map((field) => field.trim());
    if (fields[1] === "Full_Composition_Exclusion") ranges.push(parseRange(fields[0]));
  }
  return mergeRanges(ranges);
}

function contains(ranges, codePoint) {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle];
    if (range === undefined) return false;
    if (codePoint < range[0]) high = middle - 1;
    else if (codePoint > range[1]) low = middle + 1;
    else return true;
  }
  return false;
}

const decompositions = [];
const combiningClasses = [];
const compositions = [];
const exclusions = fullCompositionExclusions();
for (const line of readFileSync(resolve(ucdDirectory, "UnicodeData.txt"), "utf8").split(/\r?\n/u)) {
  if (!line) continue;
  const fields = line.split(";");
  const codePointText = fields[0];
  if (codePointText === undefined) continue;
  const codePoint = Number.parseInt(codePointText, 16);
  const combiningClass = Number.parseInt(fields[3] ?? "0", 10);
  if (combiningClass !== 0) combiningClasses.push([codePoint, combiningClass]);

  const decompositionField = fields[5] ?? "";
  if (!decompositionField || decompositionField.startsWith("<")) continue;
  const decomposition = decompositionField.split(" ").map((value) => Number.parseInt(value, 16));
  decompositions.push([codePoint, decomposition]);
  if (decomposition.length === 2 && !contains(exclusions, codePoint)) {
    compositions.push([decomposition[0], decomposition[1], codePoint]);
  }
}

const classRanges = [];
for (const [codePoint, value] of combiningClasses) {
  const previous = classRanges.at(-1);
  if (previous && previous[1] + 1 === codePoint && previous[2] === value) previous[1] = codePoint;
  else classRanges.push([codePoint, codePoint, value]);
}

const tables = {
  XID_START_RANGES: propertyRanges("DerivedCoreProperties.txt", "XID_Start"),
  XID_CONTINUE_RANGES: propertyRanges("DerivedCoreProperties.txt", "XID_Continue"),
  DEFAULT_IGNORABLE_RANGES: propertyRanges(
    "DerivedCoreProperties.txt",
    "Default_Ignorable_Code_Point",
  ),
  BIDI_CONTROL_RANGES: propertyRanges("PropList.txt", "Bidi_Control"),
  WHITE_SPACE_RANGES: propertyRanges("PropList.txt", "White_Space"),
  CANONICAL_DECOMPOSITIONS: decompositions,
  COMBINING_CLASS_RANGES: classRanges,
  CANONICAL_COMPOSITIONS: compositions,
};

const header = `/* Generated from Unicode Character Database 18.0.0.\n * Copyright © 2026 Unicode®, Inc.\n * Unicode data license: https://www.unicode.org/terms_of_use.html\n * Generator: packages/lexer/scripts/generate-unicode-data.mjs\n */\n`;
const body = Object.entries(tables)
  .map(([name, values]) => `export const ${name} = ${JSON.stringify(values)} as const;`)
  .join("\n\n");
writeFileSync(outputPath, header + body + "\n");
process.stdout.write(`Wrote Unicode 18.0.0 tables to ${outputPath}\n`);
