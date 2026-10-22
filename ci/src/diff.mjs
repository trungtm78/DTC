// Extracts the lines a change adds, with their line numbers in the new file.

const FILE_HEADER = /^\+\+\+ (?:b\/)?(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const DELETED_FILE = '/dev/null';

export function parseAddedLines(diffText) {
  const added = [];
  let file = null;
  let line = 0;

  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      file = null;
      continue;
    }
    const header = raw.match(FILE_HEADER);
    if (header) {
      file = header[1] === DELETED_FILE ? null : header[1];
      continue;
    }
    const hunk = raw.match(HUNK_HEADER);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (file === null) continue;
    if (raw.startsWith('+')) {
      added.push({ file, line, text: raw.slice(1) });
      line += 1;
    } else if (raw.startsWith(' ')) {
      line += 1;
    }
  }
  return added;
}
