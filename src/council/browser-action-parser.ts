import { assertCouncilActionJsonSize, validateCouncilActionBatch, type ParsedCouncilActionFooter } from "./browser-actions";

const OPEN = '<COUNCIL_ACTIONS version="1">';
const CLOSE = "</COUNCIL_ACTIONS>";

export function parseCouncilActionFooter(text: string): ParsedCouncilActionFooter {
  const trimmed = text.trimEnd();
  const closeAt = trimmed.lastIndexOf(CLOSE);
  if (closeAt < 0 || closeAt + CLOSE.length !== trimmed.length) throw new Error("Council action block must be terminal");
  const openAt = trimmed.lastIndexOf(OPEN, closeAt);
  if (openAt < 0) throw new Error("Council action block opener is missing");
  if (trimmed.indexOf(OPEN) !== openAt) throw new Error("multiple Council action blocks are not allowed");
  const json = trimmed.slice(openAt + OPEN.length, closeAt).trim();
  assertCouncilActionJsonSize(json);
  let decoded: unknown;
  try { decoded = JSON.parse(json); } catch { throw new Error("Council action block contains invalid JSON"); }
  return { visibleText: trimmed.slice(0, openAt).trimEnd(), batch: validateCouncilActionBatch(decoded) };
}
