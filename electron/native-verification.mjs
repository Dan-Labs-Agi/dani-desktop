// Opt-in diagnostics for disposable native acceptance runs. Never receives secrets.
export function nativeVerifyPhase(phase) {
  if (process.env.DANI_NATIVE_VERIFY === '1') console.log('DANI_NATIVE_PHASE', phase);
}
export function nativeVerifyProfile(app, bootDataDir) {
  if (process.env.DANI_NATIVE_VERIFY !== '1') return;
  console.log('DANI_NATIVE_PROFILE', JSON.stringify({
    requestedDaniDir: process.env.DANI_DATA_DIR, requestedLegacyDir: process.env.OMB_DATA_DIR,
    home: app.getPath('home'), userData: app.getPath('userData'), logs: app.getPath('logs'), bootDataDir,
  }));
}
export async function verifyPhoneIdentity(ensurePhoneSecretIdentity) {
  nativeVerifyPhase('phone-identity-start');
  await ensurePhoneSecretIdentity();
  nativeVerifyPhase('phone-identity-ready');
}
