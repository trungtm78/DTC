import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { translate } from '../i18n.mjs';
import { listOperations } from '../checks/openapi.mjs';
import { RELEASES, criticalPath } from '../plan.mjs';
import { escapeHtml, renderPage, renderTable } from './html.mjs';

// Catalogue pages rendered from the JSON/SQL/OpenAPI sources (decision D3).
// Narrative pages (Implementation_Readiness, Market_Research, UX research, ...) are hand-written
// and deliberately absent from this list so a build can never overwrite them (review finding C1).

function labels(ctx, prefix, keys) {
  return keys.map((key) => translate(ctx.messages, `${prefix}.${key}`));
}

const traceabilityPage = {
  file: 'Traceability.html',
  render(model, ctx) {
    const rows = model.trace.map((row) => [
      row.requirement,
      row.screen,
      row.backlog_id,
      (row.test_ids ?? []).join(', '),
      row.implementation_status ?? '',
    ]);
    return renderPage(
      {
        title: translate(ctx.messages, 'page.traceability.title'),
        body: renderTable(labels(ctx, 'page.traceability.col', ['requirement', 'screen', 'backlog', 'tests', 'status']), rows, {
          filterLabel: translate(ctx.messages, 'page.common.filter'),
        }),
      },
      ctx,
    );
  },
};

const backlogPage = {
  file: 'Implementation_Backlog.html',
  render(model, ctx) {
    const rows = model.backlog.map((row) => [
      `${row.id} / ${row.requirement}`,
      `${row.screen} · ${row.title ?? ''}`,
      `${row.phase ?? ''} / ${row.owner ?? ''}`,
      row.dependencies ?? '',
      `${row.status ?? ''} · ${row.readiness ?? ''}`,
    ]);
    return renderPage(
      {
        title: translate(ctx.messages, 'page.backlog.title', { count: model.backlog.length }),
        intro: [translate(ctx.messages, 'page.backlog.intro')],
        body: renderTable(labels(ctx, 'page.backlog.col', ['item', 'screen', 'phase', 'dependencies', 'status']), rows, {
          filterLabel: translate(ctx.messages, 'page.common.filter'),
        }),
      },
      ctx,
    );
  },
};

const testCataloguePage = {
  file: 'Test_Case_Catalogue.html',
  render(model, ctx) {
    const rows = model.tests.map((test) => [
      test.id,
      `${test.type ?? ''} / ${test.priority ?? ''}`,
      [test.setup, (test.steps ?? []).join(' → ')].filter(Boolean).join(' | '),
      test.expected ?? '',
      test.status ?? '',
    ]);
    return renderPage(
      {
        title: translate(ctx.messages, 'page.tests.title'),
        intro: [translate(ctx.messages, 'page.tests.intro', { count: model.tests.length })],
        body: renderTable(labels(ctx, 'page.tests.col', ['id', 'type', 'steps', 'expected', 'status']), rows, {
          filterLabel: translate(ctx.messages, 'page.common.filter'),
        }),
      },
      ctx,
    );
  },
};

const decisionRegisterPage = {
  file: 'Decision_Register.html',
  render(model, ctx) {
    const rows = (model.decisions ?? []).map((d) => [d.id, d.owner, d.deadline, d.decision, d.evidence, d.status]);
    return renderPage(
      {
        title: translate(ctx.messages, 'page.decisions.title'),
        body: renderTable(labels(ctx, 'page.decisions.col', ['id', 'owner', 'gate', 'decision', 'evidence', 'status']), rows),
      },
      ctx,
    );
  },
};

const dataDictionaryPage = {
  file: 'Data_Dictionary.html',
  render(model, ctx) {
    const columns = labels(ctx, 'page.dictionary.col', ['field', 'type']);
    const sections = Object.entries(model.entities).map(
      ([entity, fields]) =>
        `<section id="${escapeHtml(entity)}"><h2>${escapeHtml(entity)}</h2>${renderTable(columns, Object.entries(fields))}</section>`,
    );
    return renderPage(
      {
        title: translate(ctx.messages, 'page.dictionary.title', { count: Object.keys(model.entities).length }),
        intro: [translate(ctx.messages, 'page.dictionary.intro')],
        body: sections.join(''),
      },
      ctx,
    );
  },
};

const apiCataloguePage = {
  file: 'API_Catalogue.html',
  render(model, ctx) {
    const operations = listOperations(model.openapi);
    const defaultMaturity = translate(ctx.messages, 'page.api.defaultMaturity');
    const rows = operations.map(({ path, method, operation }) => [
      `${method.toUpperCase()} ${path}`,
      operation.operationId,
      operation.summary ?? '',
      `${operation['x-permission'] ?? operation['x-required-role'] ?? ''} / ${operation['x-contract-maturity'] ?? defaultMaturity}`,
    ]);
    return renderPage(
      {
        title: translate(ctx.messages, 'page.api.title', { count: operations.length }),
        intro: [translate(ctx.messages, 'page.api.intro')],
        body: renderTable(labels(ctx, 'page.api.col', ['route', 'operation', 'summary', 'permission']), rows, {
          filterLabel: translate(ctx.messages, 'page.common.filter'),
        }),
      },
      ctx,
    );
  },
};

const sum = (stories, pick) => stories.reduce((total, story) => total + (pick(story) ?? 0), 0);
const range = (min, max) => `${min}–${max}`;

const implementationPlanPage = {
  file: 'Implementation_Plan.html',
  enabled: (model) => Boolean(model.plan),
  render(model, ctx) {
    const { stories } = model.plan;
    const byRelease = RELEASES.map((release) => {
      const inRelease = stories.filter((story) => story.release === release);
      return [
        release,
        inRelease.length,
        range(sum(inRelease, (s) => s.review?.hours?.min), sum(inRelease, (s) => s.review?.hours?.max)),
        range(sum(inRelease, (s) => s.effort?.agent_hours?.min), sum(inRelease, (s) => s.effort?.agent_hours?.max)),
        inRelease.filter((s) => (s.review?.required ?? []).length > 0).length,
      ];
    });
    const path = criticalPath(stories);
    const rows = stories.map((story) => [
      story.id,
      story.release,
      story.title,
      (story.dependencies ?? []).join(', '),
      (story.review?.required ?? []).join(', '),
      range(story.review?.hours?.min, story.review?.hours?.max),
      `${range(story.effort?.agent_hours?.min, story.effort?.agent_hours?.max)} (${story.effort?.confidence ?? ''})`,
    ]);
    const summary = renderTable(labels(ctx, 'page.plan.summary', ['release', 'stories', 'review', 'agent', 'gated']), byRelease);
    const heading = translate(ctx.messages, 'page.plan.critical', { hours: path.hours });
    const critical = `<section><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(path.path.join(' → '))}</p></section>`;
    const columns = labels(ctx, 'page.plan.col', ['id', 'release', 'title', 'dependencies', 'review', 'reviewHours', 'agentHours']);
    const table = renderTable(columns, rows, { filterLabel: translate(ctx.messages, 'page.common.filter') });
    return renderPage(
      {
        title: translate(ctx.messages, 'page.plan.title', { count: stories.length }),
        intro: [translate(ctx.messages, 'page.plan.intro')],
        body: `${summary}${critical}${table}`,
      },
      ctx,
    );
  },
};

export const GENERATED_PAGES = [
  traceabilityPage,
  backlogPage,
  testCataloguePage,
  decisionRegisterPage,
  dataDictionaryPage,
  apiCataloguePage,
  implementationPlanPage,
];

export function buildPages(model, outDir, ctx) {
  return GENERATED_PAGES.filter((spec) => spec.enabled?.(model) ?? true).map((spec) => {
    const path = join(outDir, spec.file);
    writeFileSync(path, spec.render(model, ctx), 'utf8');
    return path;
  });
}
