import {
  canonicalValue,
  canonicalWithout,
  dictionaryOf,
  nameOf,
  readRevision,
  referencesIn,
  revisionEnds,
  textOf,
} from './pdf-objects';
import type { PdfObject, PdfValue, RevisionContent } from './pdf-objects';

/** The three text fields of revision 0 that numbering fills in (BR-DOC-14 a and c). */
export const NUMBER_FIELD_NAMES: readonly string[] = ['doc_number', 'doc_symbol', 'doc_date'];

export interface RevisionVerdict {
  allowed: boolean;
  /** The reason a revision was refused, for the operator log; never part of the report. */
  reason: string | null;
}

/** Object number to the latest definition seen so far. */
type KnownObjects = Map<number, PdfValue>;

interface RevisionState {
  known: KnownObjects;
  rootNum: number | null;
  acroFormNum: number | null;
}

const DISALLOWED = (reason: string): RevisionVerdict => ({ allowed: false, reason });
const ALLOWED: RevisionVerdict = { allowed: true, reason: null };

function rootOf(trailer: Map<string, PdfValue> | null): number | null {
  const root = trailer?.get('Root');
  return root?.t === 'ref' ? root.obj : null;
}

function absorb(state: RevisionState, content: RevisionContent): void {
  for (const object of content.objects) state.known.set(object.num, object.value);
  const root = rootOf(content.trailer);
  if (root !== null) state.rootNum = root;
  const catalog = state.rootNum === null ? null : dictionaryOf(state.known.get(state.rootNum));
  const acroForm = catalog?.get('AcroForm');
  state.acroFormNum = acroForm?.t === 'ref' ? acroForm.obj : null;
}

function isSignatureField(value: PdfValue | undefined): boolean {
  const dictionary = dictionaryOf(value);
  return nameOf(dictionary?.get('FT')) === 'Sig';
}

function isSignatureDictionary(value: PdfValue | undefined): boolean {
  const dictionary = dictionaryOf(value);
  if (dictionary === null || !dictionary.has('ByteRange')) return false;
  const type = nameOf(dictionary.get('Type'));
  return type === 'Sig' || type === 'DocTimeStamp' || type === null;
}

/** Objects reachable from `roots` through references, restricted to objects the revision introduced. */
function closureOver(roots: readonly number[], fresh: ReadonlyMap<number, PdfObject>, known: KnownObjects): Set<number> {
  const reached = new Set<number>();
  const queue = [...roots];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    const object = fresh.get(next);
    if (reached.has(next) || object === undefined || known.has(next)) continue;
    reached.add(next);
    queue.push(...referencesIn(object.value));
  }
  return reached;
}

function itemsOf(value: PdfValue | undefined): string[] | null {
  if (value === undefined) return [];
  return value.t === 'array' ? value.v.map((item) => canonicalValue(item)) : null;
}

/** True when `after` holds all of `before` in order and every added item is a reference to a new signature field. */
function onlyAddsSignatureFields(
  before: PdfValue | undefined,
  after: PdfValue | undefined,
  fresh: ReadonlyMap<number, PdfObject>,
  known: KnownObjects,
): boolean {
  const oldItems = itemsOf(before);
  const newItems = itemsOf(after);
  if (oldItems === null || newItems === null || after?.t !== 'array') return false;
  if (!oldItems.every((item, position) => newItems[position] === item)) return false;
  return after.v.slice(oldItems.length).every((item) => {
    if (item.t !== 'ref') return false;
    return !known.has(item.obj) && isSignatureField(fresh.get(item.obj)?.value);
  });
}

function dssRoots(revision: RevisionContent, state: RevisionState): number[] {
  const inRevision = revision.objects.find((object) => object.num === state.rootNum);
  const catalog = dictionaryOf(inRevision?.value ?? (state.rootNum === null ? undefined : state.known.get(state.rootNum)));
  return referencesIn(catalog?.get('DSS'));
}

function judgeObject(
  object: PdfObject,
  fresh: ReadonlyMap<number, PdfObject>,
  state: RevisionState,
  carried: ReadonlySet<number>,
  dss: ReadonlySet<number>,
): RevisionVerdict {
  const previous = state.known.get(object.num);
  const current = dictionaryOf(object.value);
  const before = dictionaryOf(previous);
  if (current !== null && nameOf(current.get('Type')) === 'XRef') return ALLOWED;
  if (current !== null && nameOf(current.get('Type')) === 'ObjStm') return DISALLOWED(`object stream ${object.num}`);

  if (previous === undefined) {
    if (carried.has(object.num) || dss.has(object.num)) return ALLOWED;
    if (isSignatureField(object.value) || isSignatureDictionary(object.value)) return ALLOWED;
    return DISALLOWED(`new object ${object.num}`);
  }

  if (object.num === state.rootNum) {
    return current !== null && before !== null && canonicalWithout(current, ['DSS']) === canonicalWithout(before, ['DSS'])
      ? ALLOWED
      : DISALLOWED('catalog changed beyond DSS');
  }
  if (object.num === state.acroFormNum) {
    if (current === null || before === null) return DISALLOWED('form dictionary replaced');
    const same = canonicalWithout(current, ['SigFlags', 'Fields']) === canonicalWithout(before, ['SigFlags', 'Fields']);
    return same && onlyAddsSignatureFields(before.get('Fields'), current.get('Fields'), fresh, state.known)
      ? ALLOWED
      : DISALLOWED('form dictionary changed beyond signature fields');
  }
  if (current !== null && before !== null) {
    const name = textOf(before.get('T'));
    if (name !== null && NUMBER_FIELD_NAMES.includes(name)) {
      return canonicalWithout(current, ['V', 'AP']) === canonicalWithout(before, ['V', 'AP'])
        ? ALLOWED
        : DISALLOWED(`field ${name} changed beyond value and display`);
    }
    if (isSignatureField(previous)) {
      return !before.has('V') && canonicalWithout(current, ['V', 'AP']) === canonicalWithout(before, ['V', 'AP'])
        ? ALLOWED
        : DISALLOWED('signature field changed beyond its value');
    }
    if (nameOf(before.get('Type')) === 'Page') {
      return canonicalWithout(current, ['Annots']) === canonicalWithout(before, ['Annots']) &&
        onlyAddsSignatureFields(before.get('Annots'), current.get('Annots'), fresh, state.known)
        ? ALLOWED
        : DISALLOWED('page changed beyond signature widgets');
    }
  }
  if (dss.has(object.num)) return ALLOWED;
  if (previous.t === 'array' && object.value.t === 'array') {
    return onlyAddsSignatureFields(previous, object.value, fresh, state.known)
      ? ALLOWED
      : DISALLOWED('array changed beyond signature widgets');
  }
  return DISALLOWED(`object ${object.num} changed`);
}

/** The objects a revision may add as part of an allowed change: display streams, signature values, DSS content. */
function carriedBy(revision: RevisionContent, fresh: ReadonlyMap<number, PdfObject>, state: RevisionState): Set<number> {
  const roots: number[] = [];
  for (const object of revision.objects) {
    const dictionary = dictionaryOf(object.value);
    if (dictionary === null) continue;
    const name = textOf(dictionary.get('T'));
    const isNumberField = name !== null && NUMBER_FIELD_NAMES.includes(name);
    if (isNumberField || isSignatureField(object.value)) {
      roots.push(...referencesIn(dictionary.get('AP')), ...referencesIn(dictionary.get('V')));
    }
    if (isSignatureDictionary(object.value)) roots.push(...referencesIn(dictionary.get('Reference')));
  }
  roots.push(...dssRoots(revision, state));
  return closureOver(roots, fresh, state.known);
}

/**
 * Judges one revision that follows a signature (BR-DOC-14 f7): every object it adds or changes must belong to the
 * allowed set {value and display of the three number fields, the next signature field with its value, DSS, the
 * document timestamp, cross-reference data}.
 */
function judgeRevision(revision: RevisionContent, state: RevisionState): RevisionVerdict {
  if (revision.foreign) return DISALLOWED('content that is not an object');
  const newRoot = rootOf(revision.trailer);
  if (newRoot !== null && state.rootNum !== null && newRoot !== state.rootNum) return DISALLOWED('document root replaced');
  const fresh = new Map(revision.objects.map((object) => [object.num, object] as const));
  const carried = carriedBy(revision, fresh, state);
  const dss = new Set(dssRoots(revision, state));
  for (const object of revision.objects) {
    const verdict = judgeObject(object, fresh, state, carried, dss);
    if (!verdict.allowed) return verdict;
  }
  return ALLOWED;
}

/**
 * Checks everything that was appended after the signature whose coverage ends at `coversEnd`. A coverage that does not
 * end where a revision ends is refused too: the signature then covers part of a revision.
 */
export function analyseLaterRevisions(text: string, coversEnd: number): RevisionVerdict {
  const ends = revisionEnds(text);
  if (!ends.includes(coversEnd)) return DISALLOWED('coverage does not end at a revision end');
  const state: RevisionState = { known: new Map(), rootNum: null, acroFormNum: null };
  let start = 0;
  for (const end of ends) {
    const content = readRevision(text, start, end);
    if (end > coversEnd) {
      const verdict = judgeRevision(content, state);
      if (!verdict.allowed) return verdict;
    }
    absorb(state, content);
    start = end;
  }
  // Bytes after the last cross-reference section are not a revision any reader would honour: they are not allowed.
  return text.slice(start).trim() === '' ? ALLOWED : DISALLOWED('bytes after the last revision');
}
