export const DANI_FREE_INSTANCE_ID = "dani";
export const DANI_FREE_CLIENT_INSTANCE_ID = "dani-client";

export const DANI_FREE_INSTANCE_IDS: Readonly<Record<string, true | undefined>> = {
  [DANI_FREE_INSTANCE_ID]: true,
  [DANI_FREE_CLIENT_INSTANCE_ID]: true,
};

export function isDaniFreeInstance(instance: { instanceId?: string; driverKind: string }): boolean {
  if (instance.instanceId === DANI_FREE_INSTANCE_ID) return instance.driverKind === "daniFree";
  return instance.instanceId === DANI_FREE_CLIENT_INSTANCE_ID && instance.driverKind === "opencodeGo";
}
