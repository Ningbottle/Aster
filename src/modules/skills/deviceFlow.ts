export function shouldDiscardFlow(opts: {
  show: boolean;
  flowGeneration: number;
  generation: number;
}): boolean {
  return !opts.show || opts.flowGeneration !== opts.generation;
}
