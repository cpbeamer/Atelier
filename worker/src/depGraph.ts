// Ticket batching under dependency + file-overlap constraints.
//
// Parallel ticket execution is the biggest potential throughput win for the
// autopilot — independent tickets don't need to serialise. But naive parallel
// runs will race on the git index: two developers editing the same file will
// produce merge conflicts the workflow has no tools to resolve.
//
// This module computes batches such that:
// 1. All explicit `dependencies` have completed before a ticket starts
// 2. Tickets sharing any `filesToChange` land in separate batches
//
// Within a batch, tickets can run fully in parallel. Across batches, they
// run sequentially. This gives us DeerFlow-style fan-out where it's safe,
// and back-pressure where it's not.
//
// Kept flag-gated (ATELIER_PARALLEL_TICKETS) in the workflow so the default
// path stays sequential until the full parallel-worktree machinery lands.

export interface TicketNode {
  id: string;
  dependencies: string[];
  filesToChange: string[];
}

export function detectFileOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  for (const f of b) {
    if (set.has(f)) return true;
  }
  return false;
}

/**
 * Produces an ordered list of batches. Tickets within a batch are
 * independent (no dep edges between them and no file overlap).
 * Throws if a cycle is detected.
 */
export function batchByDependencies(tickets: TicketNode[]): string[][] {
  if (tickets.length === 0) return [];

  const byId = new Map(tickets.map((t) => [t.id, t]));
  const inDegree = new Map<string, number>();
  for (const t of tickets) {
    // Only count dependencies that actually exist in this set — stale refs
    // shouldn't block progress.
    const real = t.dependencies.filter((d) => byId.has(d));
    inDegree.set(t.id, real.length);
  }

  const batches: string[][] = [];
  const remaining = new Set(tickets.map((t) => t.id));

  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => inDegree.get(id) === 0);
    if (ready.length === 0) {
      const leftover = [...remaining].join(', ');
      throw new Error(`Dependency cycle detected among tickets: ${leftover}`);
    }

    // Within a level, split by file overlap. Greedy first-fit: for each ready
    // ticket, try to place it in the first existing sub-batch that has no file
    // overlap; otherwise open a new sub-batch.
    const levelBatches: string[][] = [];
    for (const id of ready) {
      const node = byId.get(id)!;
      const fit = levelBatches.find((b) =>
        b.every((other) => !detectFileOverlap(node.filesToChange, byId.get(other)!.filesToChange)),
      );
      if (fit) fit.push(id);
      else levelBatches.push([id]);
    }
    batches.push(...levelBatches);

    // Mark ready tickets as done and decrement in-degree of their dependents.
    for (const id of ready) {
      remaining.delete(id);
      for (const t of tickets) {
        if (t.dependencies.includes(id)) {
          inDegree.set(t.id, (inDegree.get(t.id) ?? 0) - 1);
        }
      }
    }
  }

  return batches;
}
