/**
 * Response shapes the TypeScript modules consume. Written against the API
 * routes rather than the Drizzle schema, because the routes select subsets and
 * join extra columns on.
 *
 * These cover what the .ts layer touches; components still read plain objects
 * until their `<script setup>` blocks move to `lang="ts"`.
 */

export type FrameRate = '23.976' | '24' | '25' | '29.97' | '29.97df' | '30' | '50' | '59.94' | '60'

export interface Timeline {
  id: string
  productionId: string
  name: string
  profileImageId: string | null
  frameRate: FrameRate
  startFrame: number
  endFrame: number
  ltcOffsetFrames: number
  createdAt: string
  updatedAt: string
}

/** What a click can already know about a timeline before the editor loads. */
export interface OpeningTimeline {
  id: string
  name?: string
  profileImageId?: string | null
}

export interface Production {
  id: string
  name: string
  slug: string
  profileImageId: string | null
  bannerImageId: string | null
  allocatedStorage: number | null
}

/** A timeline row on the home page's "jump back in". */
export interface RecentTimeline {
  id: string
  name: string
  profileImageId: string | null
  frameRate: FrameRate
  startFrame: number
  endFrame: number
  productionId: string
  productionName: string
  productionSlug: string
  productionImageId: string | null
  companyName: string
  companySlug: string
  lastOpenedAt: string
}

export interface RecentProduction {
  id: string
  name: string
  slug: string
  profileImageId: string | null
  bannerImageId: string | null
  companyId: string
  companyName: string
  companySlug: string
  lastOpenedAt: string
}

export interface RecentActivityResponse {
  timelines: RecentTimeline[]
  productions: RecentProduction[]
}

export interface ProductionRole {
  id: string
  productionId: string
  name: string
  /** oklch hue 0–360. */
  hue: number
  /**
   * A bigint permission mask. Sent as a decimal string because JSON numbers
   * can't hold it — parse with BigInt() before testing bits.
   */
  permissions: string
  createdAt: string
}
