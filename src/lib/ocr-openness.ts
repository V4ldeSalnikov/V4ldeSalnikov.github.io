export const criteria = [
  ['weights', 'Weights', 'Downloadable model weights, including releases that require accepting terms.'],
  ['license', 'Open license', 'A license permitting use, modification and redistribution, including commercial use, without field-of-use restrictions.'],
  ['code', 'Training code', 'Public code and a recipe for the training that produced this checkpoint; inference code and generic fine-tuning tutorials are insufficient.'],
  ['data', 'Training data', 'The complete training corpus is publicly available, or can be reconstructed from public sources and a released recipe. A description alone is insufficient.'],
  ['paper', 'Paper / report', 'A public technical paper or report describing this model.'],
  ['card', 'Model documentation', 'Public documentation of the model, its intended use and how to run it.'],
] as const;
export type Criterion = typeof criteria[number][0];
export type Status = 'yes' | 'no' | 'partial' | 'unknown';
export type Evidence = { status: Status; note: string; sources: string[] };
export type Checks = Record<Criterion, Evidence>;
export type Openness = { checks: Checks; reviewed: string };
export const statusLabels: Record<Status, string> = { yes: 'Available', no: 'Not open', partial: 'Partial', unknown: 'Unknown' };

export function score(checks: Checks) {
  return Object.values(checks).filter(item => item.status === 'yes').length;
}

export function scoreLabel(checks: Checks): string {
  return `${score(checks)}/6`;
}

export const opennessAnchor = (id: string) => encodeURIComponent(id);
