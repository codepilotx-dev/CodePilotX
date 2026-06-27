export function parseConnectUrl(url: string): { serverUrl: string; authToken: string } {
  const u = new URL(url)
  return { serverUrl: u.origin, authToken: '' }
}
