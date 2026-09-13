// Resource shapes as the Cino API returns them. Records also carry any fields not named here.

type Open = { [key: string]: unknown };

export type FrameRate = '23.976' | '24' | '25' | '29.97' | '29.97df' | '30' | '50' | '59.94' | '60';
export type TrackMode = 'event' | 'clip';
export type TrackDisplay = 'normal' | 'ruler';
export type NameDisplay = 'normal' | 'stretch' | 'emphasize';
export type ClipDisplay = 'normal' | 'zebra' | 'border' | 'transparent';
export type FileType = 'image' | 'audio';
export type ImageSlot = 'profile' | 'banner';

export type PermissionName =
  | 'VIEW' | 'EDIT_TIMELINE' | 'RENAME_CLIPS' | 'MANAGE_TIMELINES' | 'MANAGE_TRACK_TYPES'
  | 'MANAGE_STORAGE' | 'MANAGE_MEMBERS' | 'MANAGE_ROLES' | 'ADMINISTRATOR';

// ── Production ────────────────────────────────────────────────────────────────

export interface Company extends Open {
  id: string;
  name: string;
  slug: string;
}

export interface Production extends Open {
  id: string;
  companyId: string;
  name: string;
  slug: string;
  allocatedStorage: number | null;
  profileImageId: string | null;
  bannerImageId: string | null;
}

export interface ProductionInfo {
  company: Company;
  production: Production;
  access: { privileged: boolean; permissions: PermissionName[] };
}

export interface PersonRef {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
}

export interface Member extends Open {
  id: string;
  createdAt: string;
  user: PersonRef & { email: string; avatarImageId: string | null; createdAt: string };
  role: { id: string; name: string; hue: number | null; permissions: string } | null;
}

export interface Role extends Open {
  id: string;
  productionId: string;
  name: string;
  hue: number | null;
  /** A bigint as a decimal string. */
  permissions: string;
}

export interface TimelineSummary extends Open {
  id: string;
  name: string;
  profileImageId: string | null;
  frameRate: FrameRate;
  startFrame: number;
  endFrame: number;
  updatedAt: string;
  trackCount: number;
}

export interface Dashboard {
  recentFiles: Array<Pick<StoredFile, 'id' | 'name' | 'type' | 'size' | 'createdAt'> & { uploader: PersonRef | null }>;
  recentMembers: Array<Pick<Member, 'id' | 'createdAt' | 'user'> & { role: { id: string; name: string; hue: number | null } | null }>;
  timelines: TimelineSummary[];
  counts: { timelines: number; members: number; files: number };
}

// ── Timelines, tracks, clips ──────────────────────────────────────────────────

export interface Timeline extends Open {
  id: string;
  productionId: string;
  name: string;
  frameRate: FrameRate;
  startFrame: number;
  endFrame: number;
  ltcOffsetFrames: number;
  profileImageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineInput {
  name: string;
  endFrame: number;
  frameRate?: FrameRate;
  startFrame?: number;
  ltcOffsetFrames?: number;
}

export type TimelinePatch = Partial<TimelineInput>;

export interface TrackRecord extends Open {
  id: string;
  timelineId: string;
  typeId: string | null;
  sourceId: string | null;
  name: string;
  icon: string | null;
  mode: TrackMode;
  sortOrder: number;
  isMuted: boolean;
  isLocked: boolean;
}

export interface ClipRecord extends Open {
  id: string;
  trackId: string;
  label: string | null;
  position: number;
  mediaStart: number | null;
  end: number | null;
  fileId: string | null;
  sourceId: string | null;
  hue: number | null;
  data: Record<string, unknown> | null;
}

export interface TimelineSnapshot {
  timeline: Timeline;
  tracks: Array<TrackRecord & { clips: ClipRecord[] }>;
  trackTypes: TrackType[];
  sources: Source[];
  canEdit: boolean;
}

export interface TrackInput {
  typeId: string;
  name: string;
  icon?: string | null;
  sourceId?: string | null;
  sortOrder?: number;
}

export type TrackPatch = Partial<{
  name: string;
  icon: string | null;
  isMuted: boolean;
  isLocked: boolean;
  sourceId: string | null;
  sortOrder: number;
}>;

export interface ClipInput {
  trackId: string;
  position: number;
  label?: string;
  fileId?: string | null;
  mediaStart?: number | null;
  end?: number | null;
  sourceId?: string | null;
  hue?: number | null;
  /** At most 2 KB serialized. */
  data?: Record<string, unknown> | null;
}

/** Send only the fields that change: a whole row would undo someone else's edit. */
export type ClipPatch = Partial<Omit<ClipInput, 'trackId'>>;

// ── Track types and sources ───────────────────────────────────────────────────

export interface TrackTypeBehaviour {
  trackDisplay: TrackDisplay;
  nameDisplay: NameDisplay;
  clipDisplay: ClipDisplay;
  metronome: boolean;
  tts: boolean;
}

export interface TrackType extends Open, TrackTypeBehaviour {
  id: string;
  productionId: string;
  name: string;
  hue: number | null;
  icon: string | null;
  trackMode: TrackMode;
  sourceSetId: string | null;
  sortOrder: number;
}

export interface TrackTypeInput extends Partial<TrackTypeBehaviour> {
  name: string;
  hue?: number;
  icon?: string | null;
  trackMode?: TrackMode;
  sourceSetId?: string | null;
  sortOrder?: number;
}

export type TrackTypePatch = Partial<TrackTypeInput>;

export interface TrackTypePreset {
  id: string;
  name: string;
  description: string;
  supportsCameraSet?: boolean;
  settings: TrackTypeBehaviour & { hue: number; icon: string; trackMode: TrackMode };
}

export interface PresetInput {
  presetId: string;
  name?: string;
  sortOrder?: number;
  /** Also create a source set of cameras C1…Cn, for presets that support it. */
  cameraSet?: { name: string; count: number };
}

export interface PresetResult {
  trackType: TrackType;
  sourceSet: SourceSet | null;
  sources: Source[];
}

export interface SourceSet extends Open {
  id: string;
  productionId: string;
  name: string;
  icon: string | null;
}

export interface SourceSetInput {
  name: string;
  icon?: string | null;
}

export interface Source extends Open {
  id: string;
  productionId: string;
  sourceSetId: string | null;
  name: string;
  /** A short code, e.g. "C1" or "CRN". */
  shortName: string;
  hue: number;
  icon: string | null;
  data: unknown;
}

export interface SourceInput {
  name: string;
  shortName: string;
  hue: number;
  icon?: string | null;
  data?: unknown;
}

export type SourcePatch = Partial<SourceInput>;

// ── Storage ───────────────────────────────────────────────────────────────────

export interface ImageVersion {
  id: string;
  fileId: string;
  quality: number;
  size: number;
  createdAt: string;
}

export interface StoredFile extends Open {
  id: string;
  productionId: string | null;
  folderId: string | null;
  name: string;
  mimeType: string;
  size: number;
  type: FileType;
  createdAt: string;
  versions?: ImageVersion[];
}

export interface Folder extends Open {
  id: string;
  productionId: string;
  parentId: string | null;
  name: string;
  hue: number | null;
  fileCount?: number;
  folderCount?: number;
}

export interface FolderListing {
  folders: Folder[];
  files: StoredFile[];
}

export interface FolderInput {
  name: string;
  parentId?: string | null;
  hue?: number | null;
}

export interface StorageStats {
  usedStorage: number;
  allocatedStorage: number | null;
  breakdown: Array<{ type: FileType; size: number }>;
}

export interface UploadResult {
  file: StoredFile;
  versions?: ImageVersion[];
}
