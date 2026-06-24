// Bit positions are EXPLICIT — never derived from array index.
// Adding a new permission: pick the next unused bit (increment the shift),
// never change an existing one. Stored bigints in the DB depend on these
// values staying stable forever.

export const Permission = {
  VIEW:           1n << 0n,
  EDIT_TIMELINE:  1n << 1n,
  MANAGE_STORAGE: 1n << 2n,
  MANAGE_MEMBERS: 1n << 3n,
  MANAGE_ROLES:   1n << 4n,
  ADMINISTRATOR:  1n << 5n,
} as const satisfies Record<string, bigint>;

export type PermissionName = keyof typeof Permission;

export const PERMISSIONS = Object.keys(Permission) as PermissionName[];

export function encode(names: PermissionName[]): bigint {
  return names.reduce((acc, n) => acc | Permission[n], 0n);
}

export function decode(bits: bigint): PermissionName[] {
  return PERMISSIONS.filter(n => (bits & Permission[n]) !== 0n);
}
