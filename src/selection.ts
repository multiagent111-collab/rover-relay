import { z } from 'zod';

const identifier = z.string().min(1).max(200);
export const selectionSchema = z.object({
  contractVersion: z.literal('selection-1.0'),
  snapshotAt: z.string().datetime({ offset: true }),
  serviceType: z.string().regex(/^[A-Z][A-Z0-9_.]{0,63}$/),
  vehicleType: z.string().max(64).default(''),
  providers: z.array(z.object({
    id: identifier,
    displayName: z.string().min(1).max(120),
    vehicleType: z.string().max(64),
    serviceTypes: z.array(z.string().regex(/^[A-Z][A-Z0-9_.]{0,63}$/)).max(50),
    available: z.boolean(),
    eligible: z.boolean(),
    connected: z.boolean(),
    lastSeenAt: z.string().datetime({ offset: true }),
  }).strict()).max(100),
}).strict();
export type SelectionInput = z.infer<typeof selectionSchema>;

export function shortlist(raw: unknown, now = Date.now()) {
  const input = selectionSchema.parse(raw);
  const snapshotAt = Date.parse(input.snapshotAt);
  if (snapshotAt > now + 5000 || now - snapshotAt > 30000) throw Error('snapshot_stale');
  const seen = new Set<string>();
  const exclusions: { id: string; reasons: string[] }[] = [];
  const options = input.providers.filter(provider => {
    if (seen.has(provider.id)) throw Error('duplicate_provider');
    seen.add(provider.id);
    const reasons: string[] = [];
    const age = now - Date.parse(provider.lastSeenAt);
    if (!provider.available) reasons.push('unavailable');
    if (!provider.eligible) reasons.push('ineligible');
    if (!provider.connected) reasons.push('disconnected');
    if (age < -5000 || age > 60000) reasons.push('stale');
    if (!provider.serviceTypes.includes(input.serviceType)) reasons.push('service_mismatch');
    if (input.vehicleType && provider.vehicleType.toUpperCase() !== input.vehicleType.toUpperCase()) reasons.push('vehicle_mismatch');
    if (reasons.length) exclusions.push({ id: provider.id, reasons });
    return reasons.length === 0;
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // Stable ordering is not a nearest/cheapest claim. Revalidate before any request.
  const activity = [
    { role: 'Observer', decision: 'snapshot_received', count: input.providers.length },
    { role: 'Filter', decision: 'availability_eligibility_service_freshness_checked', count: exclusions.length },
    { role: 'Ranker', decision: 'stable_provider_id_order', count: options.length },
    { role: 'Critic', decision: 'all_options_pass_hard_constraints', count: options.length },
  ];
  return {
    contractVersion: 'selection-1.0' as const,
    source: 'caller_supplied_snapshot' as const,
    snapshotAt: input.snapshotAt,
    expiresAt: new Date(Math.min(snapshotAt + 30000, ...options.map(p => Date.parse(p.lastSeenAt) + 60000))).toISOString(),
    serviceType: input.serviceType,
    execution: 'none' as const,
    ranking: 'deterministic_id_order' as const,
    suggestedId: options[0]?.id ?? null,
    options: options.map(p => ({ id: p.id, displayName: p.displayName, vehicleType: p.vehicleType })),
    exclusions, activity,
  };
}
