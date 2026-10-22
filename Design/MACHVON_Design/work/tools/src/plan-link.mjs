import { RELEASES } from './plan.mjs';

// Links screen-level backlog rows (the baseline structure) to the plan: the earliest release in
// which a story delivers the screen, and the stories that deliver it.

const releaseRank = (release) => RELEASES.indexOf(release);

export function linkBacklog(rows, stories) {
  const unplanned = [];
  const linked = rows.map((row) => {
    const covering = stories.filter((story) => (story.screens ?? []).includes(row.screen));
    if (covering.length === 0) {
      unplanned.push(row.id);
      return { ...row, release: null, stories: [] };
    }
    const earliest = covering.reduce((best, story) => (releaseRank(story.release) < releaseRank(best) ? story.release : best), covering[0].release);
    return { ...row, release: earliest, stories: covering.map((story) => story.id).sort() };
  });
  return { rows: linked, unplanned };
}
