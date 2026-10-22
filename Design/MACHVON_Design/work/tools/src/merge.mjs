// Merges per-module fragments written by parallel authors into the single-source
// engineering files. Records are upserted by stable keys; two fragments that change
// the same record differently are reported as conflicts instead of silently winning.

const RECORD_COLLECTIONS = {
  screens: (r) => r.id,
  backlog: (r) => r.id,
  trace: (r) => `${r.requirement}|${r.screen}`,
  tests: (r) => r.id,
  nonFunctional: (r) => r.id,
  decisions: (r) => r.id,
};
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function createConflictTracker() {
  const owners = new Map();
  const conflicts = [];
  return {
    claim(collection, key, module, value) {
      const id = `${collection}|${key}`;
      const serialized = JSON.stringify(value);
      const previous = owners.get(id);
      if (previous && previous.value !== serialized) {
        conflicts.push({ collection, key, modules: [previous.module, module] });
      } else if (!previous) {
        owners.set(id, { module, value: serialized });
      }
    },
    conflicts,
  };
}

function upsertRecords(records, incoming, keyOf) {
  const result = [...records];
  for (const record of incoming) {
    const index = result.findIndex((existing) => keyOf(existing) === keyOf(record));
    if (index >= 0) result[index] = record;
    else result.push(record);
  }
  return result;
}

function mergeOpenApi(openapi, fragmentApi, module, tracker) {
  for (const [path, item] of Object.entries(fragmentApi.paths ?? {})) {
    openapi.paths[path] ??= {};
    for (const method of HTTP_METHODS.filter((m) => item[m])) {
      tracker.claim('openapi', `${method.toUpperCase()} ${path}`, module, item[method]);
      openapi.paths[path][method] = item[method];
    }
  }
  openapi.components ??= {};
  openapi.components.schemas = { ...openapi.components.schemas, ...(fragmentApi.schemas ?? {}) };
}

export function mergeSqlSection(sql, module, ddl) {
  const begin = `-- BEGIN module ${module}`;
  const end = `-- END module ${module}`;
  const section = `${begin}\n${ddl.trim()}\n${end}`;
  const pattern = new RegExp(`${begin}[\\s\\S]*?${end}`);
  return pattern.test(sql) ? sql.replace(pattern, section) : `${sql.trimEnd()}\n\n${section}\n`;
}

export function mergeFragments(baseSources, fragments) {
  const sources = structuredClone(baseSources);
  const tracker = createConflictTracker();

  for (const fragment of fragments) {
    const { module } = fragment;
    for (const [collection, keyOf] of Object.entries(RECORD_COLLECTIONS)) {
      const incoming = fragment[collection] ?? [];
      for (const record of incoming) tracker.claim(collection, keyOf(record), module, record);
      sources[collection] = upsertRecords(sources[collection] ?? [], incoming, keyOf);
    }
    if (fragment.openapi) mergeOpenApi(sources.openapi, fragment.openapi, module, tracker);
    for (const [entity, fields] of Object.entries(fragment.entities ?? {})) {
      tracker.claim('entities', entity, module, fields);
      sources.dictionary.entities[entity] = fields;
    }
    if (fragment.sql) sources.sql = mergeSqlSection(sources.sql, module, fragment.sql);
  }
  return { sources, conflicts: tracker.conflicts };
}
