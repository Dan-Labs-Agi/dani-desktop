/** Immutable bundled Python may not add bytecode or install optional packages.
 * Clearing the durable target matters: upstream permits installs when one is set
 * even with HERMES_DISABLE_LAZY_INSTALLS=1. Dependencies must be hash-pinned at build.
 */
export function managedHermesEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...env, PYTHONDONTWRITEBYTECODE: '1', HERMES_DISABLE_LAZY_INSTALLS: '1', HERMES_LAZY_INSTALL_TARGET: '' };
}
