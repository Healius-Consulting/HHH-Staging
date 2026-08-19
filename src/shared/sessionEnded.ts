export function shouldDispatchSessionEnded(status: number, code: string | undefined, pathname: string): boolean {
  if (status !== 401) return false;
  if (code === 'APP_CHECK_REQUIRED') return false;
  if (pathname === '/login' || pathname === '/reset-password') return false;
  return true;
}
