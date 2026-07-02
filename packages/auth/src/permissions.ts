// Bit positions are EXPLICIT — never derived from array index.
// Adding a new permission: pick the next unused bit (increment the shift),
// never change an existing one. Stored bigints in the DB depend on these
// values staying stable forever.

export const Permission = {
  VIEW:                1n << 0n,
  EDIT_TIMELINE:       1n << 1n,
  MANAGE_STORAGE:      1n << 2n,
  MANAGE_MEMBERS:      1n << 3n,
  MANAGE_ROLES:        1n << 4n,
  ADMINISTRATOR:       1n << 5n,
  MANAGE_TRACK_TYPES:  1n << 6n,  // create / edit / delete track types and source sets
  MANAGE_TIMELINES:    1n << 7n,  // create / edit / delete timelines
} as const satisfies Record<string, bigint>;

export type PermissionName = keyof typeof Permission;

export const PERMISSIONS = Object.keys(Permission) as PermissionName[];

/** Human-readable descriptions used in permission-denied error messages. */
export const PERMISSION_MESSAGES: Record<PermissionName, string> = {
  VIEW:                'view this production',
  EDIT_TIMELINE:       'edit the timeline',
  MANAGE_STORAGE:      'manage storage',
  MANAGE_MEMBERS:      'manage members',
  MANAGE_ROLES:        'manage roles',
  ADMINISTRATOR:       'perform administrator actions',
  MANAGE_TRACK_TYPES:  'manage track types and source sets',
  MANAGE_TIMELINES:    'manage timelines',
};

export function encode(names: PermissionName[]): bigint {
  return names.reduce((acc, n) => acc | Permission[n], 0n);
}

export function decode(bits: bigint): PermissionName[] {
  return PERMISSIONS.filter(n => (bits & Permission[n]) !== 0n);
}
