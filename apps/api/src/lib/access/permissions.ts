import { Permission } from "@starling/auth/permissions"

export function can(
  globalRole: 'user' | 'admin',
  rolePermissions: bigint | null,   // null = no role / role was deleted
  required: bigint,
): boolean {
  if (globalRole === 'admin') return true;                  // global short-circuit
  const perms = rolePermissions ?? 0n;                      // the "set null" / fresh-member case
  if ((perms & Permission.ADMINISTRATOR) !== 0n) return true; // production admin
  return (perms & required) !== 0n;
}