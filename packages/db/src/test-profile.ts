const VECTOR_EXTENSION_LINE = 'CREATE EXTENSION IF NOT EXISTS vector;';
const VECTOR_COLUMN_TYPE = 'vector(1024)';

/**
 * Converts the production schema SQL into the TEST profile: the pgvector extension is not
 * available in the embedded PostgreSQL build, so vector columns become plain real arrays.
 */
export function applyTestProfile(sql: string): string {
  return sql.split(VECTOR_EXTENSION_LINE).join('').split(VECTOR_COLUMN_TYPE).join('real[]');
}
