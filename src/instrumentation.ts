export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { installE2eFetch } = await import('./e2e-fixtures/install')
  installE2eFetch()
}
