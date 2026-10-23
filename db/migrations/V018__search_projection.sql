-- Authored by hand (not generated): the projection behind searchGlobal (ST-IAM-008) and its isolation gate (ST-KERNEL-025).
-- One row per searchable entity of a tenant: the text to match, the classification that decides what a hit may show, and
-- the owner unit (id and path) that the access scope of the caller is judged on, before anything is ranked.
-- The next free platform number was taken at integration time (V012, V014 and V017 belong to other open tasks).
CREATE TABLE machvon.search_document (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  classification text NOT NULL DEFAULT 'INTERNAL' CHECK (classification IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'PERSONAL')),
  owner_unit_id uuid NOT NULL,
  owner_unit_path text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || body)) STORED,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE UNIQUE INDEX search_document_entity_uq ON machvon.search_document (tenant_id, entity_id, entity_type);
CREATE INDEX search_document_owner_unit_id_idx ON machvon.search_document (tenant_id, owner_unit_id);
CREATE INDEX search_document_vector_idx ON machvon.search_document USING gin (search_vector);

ALTER TABLE machvon.search_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE machvon.search_document FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON machvon.search_document AS RESTRICTIVE FOR ALL
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_access ON machvon.search_document AS PERMISSIVE FOR ALL
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
