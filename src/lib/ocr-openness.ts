export const criteria = [
  ['weights', 'Weights', 'Downloadable model weights, including releases that require accepting terms.'],
  ['license', 'Open license', 'A license permitting use, modification and redistribution, including commercial use, without field-of-use restrictions.'],
  ['code', 'Training code', 'Public code and a recipe for the training that produced this checkpoint; inference code and generic fine-tuning tutorials are insufficient.'],
  ['data', 'Training data', 'The complete training corpus is publicly available, or can be reconstructed from public sources and a released recipe. A description alone is insufficient.'],
  ['paper', 'Paper / report', 'A public technical paper or report describing this model and training stage.'],
  ['card', 'Model documentation', 'Public documentation of the model, its intended use and how to run it.'],
] as const;
export type Criterion = typeof criteria[number][0];
export type Status = 'yes' | 'no' | 'partial' | 'unknown';
export type Evidence = { status: Status; note: string; sources: string[] };
export type Checks = Record<Criterion, Evidence>;
export type Stage = { name: string; description: string; checks: Checks };
export type Openness = { base: Stage; post: Stage; reviewed: string };
export const statusLabels: Record<Status, string> = { yes: 'Available', no: 'Not open', partial: 'Partial', unknown: 'Unknown' };

// Release artifacts describe the evaluated model. Training checks cover its
// entire lineage, so an open fine-tune cannot erase an upstream training gap.
export function overallChecks(profile: Openness): Checks {
  const checks = { ...profile.post.checks };
  for (const key of ['code', 'data'] as const) {
    const a = profile.base.checks[key], b = profile.post.checks[key];
    const status = [a.status, b.status].includes('no') ? 'no'
      : [a.status, b.status].includes('partial') ? 'partial'
      : [a.status, b.status].includes('unknown') ? 'unknown' : 'yes';
    checks[key] = { status, note: `Base: ${a.note} Post-training: ${b.note}`, sources: [...new Set([...a.sources, ...b.sources])] };
  }
  return checks;
}

export function score(checks: Checks) {
  const values = Object.values(checks);
  const confirmed = values.filter(item => item.status === 'yes').length;
  const unknown = values.filter(item => item.status === 'unknown').length;
  return { confirmed, unknown, possible: confirmed + unknown };
}

export function scoreLabel(checks: Checks): string {
  const { confirmed, unknown, possible } = score(checks);
  if (unknown === 6) return 'Unknown';
  return `${confirmed}${unknown ? `–${possible}` : ''}/6`;
}

export const opennessAnchor = (id: string) => encodeURIComponent(id);
