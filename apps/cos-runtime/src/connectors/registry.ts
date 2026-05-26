/**
 * Registered connector types for AC-23 extensibility.
 * Channel connectors (SMS, WhatsApp, etc.) are Phase 2+ — no stubs.
 */
export const CONNECTOR_REGISTRY = {
  "google-calendar": { status: "implemented" as const, product: true },
  gmail: { status: "implemented" as const, product: true },
  asana: { status: "implemented" as const, product: true },
  "microsoft-calendar": { status: "implemented" as const, product: true },
  "microsoft-mail": { status: "implemented" as const, product: true },
  sms: { status: "deferred" as const, product: false },
  whatsapp: { status: "deferred" as const, product: false },
  telegram: { status: "implemented" as const, type: "delivery" as const },
  x: { status: "deferred" as const, product: false },
} as const;

export type RegistryConnectorId = keyof typeof CONNECTOR_REGISTRY;

export function listImplementedConnectors(): RegistryConnectorId[] {
  return (Object.entries(CONNECTOR_REGISTRY) as [RegistryConnectorId, (typeof CONNECTOR_REGISTRY)[RegistryConnectorId]][])
    .filter(([, v]) => v.status === "implemented")
    .map(([k]) => k);
}
