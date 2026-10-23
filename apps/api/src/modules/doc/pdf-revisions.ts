import {
  canonicalValue,
  canonicalWithout,
  dictionaryOf,
  nameOf,
  readRevision,
  referencesIn,
  revisionBoundary,
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
  infoNum: number | null;
  /** Every object seen so far by the offset of its header: what a cross-reference entry can point at. */
  byOffset: Map<number, PdfObject>;
  /** The `startxref` of the latest revision: the next revision links to it with /Prev. */
  startXref: number | null;
  /** The `/Size` of the latest trailer. */
  size: number;
  /** Objects that only validation data uses: the DSS and what it reaches, minus everything the document content reaches. */
  dssOwned: ReadonlySet<number>;
}

/** What a certification signature (DocMDP) allows after it; without one the application allowance alone applies. */
export interface RevisionPermissions {
  /** Values and display of form fields may change. */
  fillForms: boolean;
  /** Signature fields may be added and signed. */
  sign: boolean;
}

const DISALLOWED = (reason: string): RevisionVerdict => ({ allowed: false, reason });
const ALLOWED: RevisionVerdict = { allowed: true, reason: null };

/**
 * DocMDP P=1 allows no change at all (validation data and document timestamps are not changes); P=2 and P=3 allow form
 * fill-in and signing, which is all the application ever does. Annotation changes (P=3) are never allowed here.
 */
export function permissionsOf(docMdpLevel: number | null): RevisionPermissions {
  return docMdpLevel === 1 ? { fillForms: false, sign: false } : { fillForms: true, sign: true };
}

function rootOf(trailer: Map<string, PdfValue> | null): number | null {
  const root = trailer?.get('Root');
  return root?.t === 'ref' ? root.obj : null;
}

/** Object numbers reachable from `roots` through the definitions in `known`. */
function reachableFrom(roots: readonly number[], known: KnownObjects): Set<number> {
  const reached = new Set<number>();
  const queue = [...roots];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    if (reached.has(next)) continue;
    reached.add(next);
    queue.push(...referencesIn(known.get(next)));
  }
  return reached;
}

function ownedByValidationData(state: RevisionState): ReadonlySet<number> {
  const catalog = state.rootNum === null ? null : dictionaryOf(state.known.get(state.rootNum));
  if (catalog === null) return new Set();
  const validation = reachableFrom(referencesIn(catalog.get('DSS')), state.known);
  const contentRoots = [...catalog.entries()].filter(([key]) => key !== 'DSS').flatMap(([, member]) => referencesIn(member));
  if (state.infoNum !== null) contentRoots.push(state.infoNum);
  const content = reachableFrom(contentRoots, state.known);
  return new Set([...validation].filter((num) => !content.has(num)));
}

/** Takes a revision into the state: the latest definition of each object is the one its cross-reference names. */
function absorb(state: RevisionState, content: RevisionContent): void {
  for (const object of content.objects) {
    state.known.set(object.num, object.value);
    state.byOffset.set(object.offset, object);
  }
  for (const entry of content.xref) {
    const object = entry.kind === 'inuse' ? state.byOffset.get(entry.offset) : undefined;
    if (object !== undefined && object.num === entry.num) state.known.set(entry.num, object.value);
  }
  const root = rootOf(content.trailer);
  if (root !== null) state.rootNum = root;
  const info = content.trailer?.get('Info');
  if (info?.t === 'ref') state.infoNum = info.obj;
  const size = content.trailer?.get('Size');
  if (size?.t === 'num') state.size = size.v;
  if (content.startXref !== null) state.startXref = content.startXref;
  const catalog = state.rootNum === null ? null : dictionaryOf(state.known.get(state.rootNum));
  const acroForm = catalog?.get('AcroForm');
  state.acroFormNum = acroForm?.t === 'ref' ? acroForm.obj : null;
  state.dssOwned = ownedByValidationData(state);
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

interface ValidationData {
  /** The objects the DSS of the catalog (as this revision leaves it) consists of. */
  members: ReadonlySet<number>;
  /** Set when the DSS reaches an object of the document content that this revision also rewrites. */
  violation: string | null;
}

/**
 * Walks the DSS the way a reader would, from the catalog. Validation data may bring new objects and rewrite the objects it
 * already owns; reaching an existing content object that the same revision rewrites would make the DSS an exception that
 * authorises replacing content, so it is a violation.
 */
function walkValidationData(revision: RevisionContent, fresh: ReadonlyMap<number, PdfObject>, state: RevisionState): ValidationData {
  const members = new Set<number>();
  const queue = dssRoots(revision, state);
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    if (members.has(next)) continue;
    if (state.known.has(next) && !state.dssOwned.has(next) && fresh.has(next)) {
      return { members, violation: `validation data reaches existing object ${next}` };
    }
    members.add(next);
    queue.push(...referencesIn(fresh.get(next)?.value ?? state.known.get(next)));
  }
  return { members, violation: null };
}

const REFUSED_BY_LEVEL_1_FILL = 'DocMDP level 1 forbids filling in fields';
const REFUSED_BY_LEVEL_1_SIGN = 'DocMDP level 1 forbids signing';

/** True when the signature field's new value is a document timestamp, which never certifies and is not a change. */
function holdsDocumentTimestamp(field: Map<string, PdfValue>, fresh: ReadonlyMap<number, PdfObject>): boolean {
  const value = field.get('V');
  if (value?.t !== 'ref') return false;
  return nameOf(dictionaryOf(fresh.get(value.obj)?.value)?.get('Type')) === 'DocTimeStamp';
}

function judgeObject(
  object: PdfObject,
  fresh: ReadonlyMap<number, PdfObject>,
  state: RevisionState,
  carried: ReadonlySet<number>,
  dss: ReadonlySet<number>,
  permissions: RevisionPermissions,
): RevisionVerdict {
  const previous = state.known.get(object.num);
  const current = dictionaryOf(object.value);
  const before = dictionaryOf(previous);
  if (current !== null && nameOf(current.get('Type')) === 'XRef') return ALLOWED;
  if (current !== null && nameOf(current.get('Type')) === 'ObjStm') return DISALLOWED(`object stream ${object.num}`);

  if (previous === undefined) {
    if (dss.has(object.num)) return ALLOWED;
    if (isSignatureField(object.value)) return permissions.sign ? ALLOWED : DISALLOWED(REFUSED_BY_LEVEL_1_SIGN);
    if (carried.has(object.num)) return ALLOWED;
    if (isSignatureDictionary(object.value)) return ALLOWED;
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
    if (!same || !onlyAddsSignatureFields(before.get('Fields'), current.get('Fields'), fresh, state.known)) {
      return DISALLOWED('form dictionary changed beyond signature fields');
    }
    return permissions.sign || canonicalValue(current.get('Fields')) === canonicalValue(before.get('Fields')) ? ALLOWED : DISALLOWED(REFUSED_BY_LEVEL_1_SIGN);
  }
  if (current !== null && before !== null) {
    const name = textOf(before.get('T'));
    if (name !== null && NUMBER_FIELD_NAMES.includes(name)) {
      if (canonicalWithout(current, ['V', 'AP']) !== canonicalWithout(before, ['V', 'AP'])) return DISALLOWED(`field ${name} changed beyond value and display`);
      return permissions.fillForms ? ALLOWED : DISALLOWED(REFUSED_BY_LEVEL_1_FILL);
    }
    if (isSignatureField(previous)) {
      if (before.has('V') || canonicalWithout(current, ['V', 'AP']) !== canonicalWithout(before, ['V', 'AP'])) {
        return DISALLOWED('signature field changed beyond its value');
      }
      return permissions.sign || holdsDocumentTimestamp(current, fresh) ? ALLOWED : DISALLOWED(REFUSED_BY_LEVEL_1_SIGN);
    }
    if (nameOf(before.get('Type')) === 'Page') {
      if (canonicalWithout(current, ['Annots']) !== canonicalWithout(before, ['Annots']) || !onlyAddsSignatureFields(before.get('Annots'), current.get('Annots'), fresh, state.known)) {
        return DISALLOWED('page changed beyond signature widgets');
      }
      return permissions.sign || canonicalValue(current.get('Annots')) === canonicalValue(before.get('Annots')) ? ALLOWED : DISALLOWED(REFUSED_BY_LEVEL_1_SIGN);
    }
  }
  if (dss.has(object.num)) return ALLOWED;
  if (previous.t === 'array' && object.value.t === 'array') {
    if (!onlyAddsSignatureFields(previous, object.value, fresh, state.known)) return DISALLOWED('array changed beyond signature widgets');
    return permissions.sign || canonicalValue(previous) === canonicalValue(object.value) ? ALLOWED : DISALLOWED(REFUSED_BY_LEVEL_1_SIGN);
  }
  return DISALLOWED(`object ${object.num} changed`);
}

/** The objects a revision may add as part of an allowed change: display streams, signature values, DSS content. */
function carriedBy(revision: RevisionContent, fresh: ReadonlyMap<number, PdfObject>, state: RevisionState, dss: ReadonlySet<number>): Set<number> {
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
  roots.push(...dss);
  return closureOver(roots, fresh, state.known);
}

/**
 * Judges the cross-reference data of a revision after a signature. An entry decides which definition of an object a reader
 * uses, so it is held to the same rule as the objects: the revision may map only objects it defines itself, must chain to
 * the revision before it, and must not free, shrink or redirect anything.
 */
function judgeCrossReference(revision: RevisionContent, state: RevisionState): RevisionVerdict {
  if (revision.xrefInvalid) return DISALLOWED('cross-reference data that cannot be read');
  if (revision.startXref === null || revision.xrefAt === null || revision.startXref !== revision.xrefAt) {
    return DISALLOWED('startxref does not point at the cross-reference section of its revision');
  }
  const trailer = revision.trailer;
  if (trailer === null) return DISALLOWED('revision without a trailer');
  if (trailer.has('XRefStm')) return DISALLOWED('hybrid cross-reference');
  if (trailer.has('Encrypt')) return DISALLOWED('trailer Encrypt');
  const previous = trailer.get('Prev');
  if (previous?.t !== 'num' || previous.v !== state.startXref) return DISALLOWED('cross-reference chain broken');
  const size = trailer.get('Size');
  if (size?.t !== 'num' || size.v < state.size) return DISALLOWED('trailer Size shrinks');
  const own = new Map(revision.objects.map((object) => [object.offset, object] as const));
  const mapped = new Set<number>();
  for (const entry of revision.xref) {
    if (entry.kind === 'free') {
      if (entry.num !== 0) return DISALLOWED(`object ${entry.num} is freed`);
      continue;
    }
    const object = entry.kind === 'inuse' ? own.get(entry.offset) : undefined;
    if (object === undefined || object.num !== entry.num || object.gen !== entry.gen) {
      return DISALLOWED(`cross-reference entry of object ${entry.num} points outside the revision`);
    }
    mapped.add(entry.offset);
  }
  for (const object of revision.objects) {
    const isCrossReference = nameOf(dictionaryOf(object.value)?.get('Type')) === 'XRef';
    if (!isCrossReference && !mapped.has(object.offset)) return DISALLOWED(`object ${object.num} is not in the cross-reference`);
  }
  return ALLOWED;
}

/**
 * Judges one revision that follows a signature (BR-DOC-14 f7): every object it adds or changes must belong to the
 * allowed set {value and display of the three number fields, the next signature field with its value, DSS, the
 * document timestamp, cross-reference data}, and its cross-reference data may only map what the revision defines.
 */
function judgeRevision(revision: RevisionContent, state: RevisionState, permissions: RevisionPermissions): RevisionVerdict {
  if (revision.foreign) return DISALLOWED('content that is not an object');
  const crossReference = judgeCrossReference(revision, state);
  if (!crossReference.allowed) return crossReference;
  if (state.rootNum !== null && rootOf(revision.trailer) !== state.rootNum) return DISALLOWED('document root replaced');
  const fresh = new Map(revision.objects.map((object) => [object.num, object] as const));
  const validation = walkValidationData(revision, fresh, state);
  if (validation.violation !== null) return DISALLOWED(validation.violation);
  const carried = carriedBy(revision, fresh, state, validation.members);
  for (const object of revision.objects) {
    const verdict = judgeObject(object, fresh, state, carried, validation.members, permissions);
    if (!verdict.allowed) return verdict;
  }
  return ALLOWED;
}

/**
 * Checks everything that was appended after the signature whose coverage ends at `coversEnd`. A coverage that does not
 * end where a revision ends is refused too: the signature then covers part of a revision. `docMdpLevel` is the level of the
 * certification signature of the file, when it has one: it bounds every later revision, whichever signature is checked.
 */
export function analyseLaterRevisions(text: string, coversEnd: number, docMdpLevel: number | null = null): RevisionVerdict {
  const ends = revisionEnds(text);
  const boundary = revisionBoundary(text, ends, coversEnd);
  if (boundary === undefined) return DISALLOWED('coverage does not end at a revision end');
  const permissions = permissionsOf(docMdpLevel);
  const state: RevisionState = {
    known: new Map(),
    rootNum: null,
    acroFormNum: null,
    infoNum: null,
    byOffset: new Map(),
    startXref: null,
    size: 0,
    dssOwned: new Set(),
  };
  let start = 0;
  for (const end of ends) {
    const content = readRevision(text, start, end);
    if (end > boundary) {
      const verdict = judgeRevision(content, state, permissions);
      if (!verdict.allowed) return verdict;
    }
    absorb(state, content);
    start = end;
  }
  // Bytes after the last cross-reference section are not a revision any reader would honour: they are not allowed.
  return text.slice(start).trim() === '' ? ALLOWED : DISALLOWED('bytes after the last revision');
}
