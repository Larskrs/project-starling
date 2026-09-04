<script setup lang="ts">
import { computed, onMounted, provide, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button, EmptyState, PromptDialog, SwitchTab } from '@starling/ui'
import TrackHeader from '../TimelineEditor/components/TrackHeader.vue'
import TrackLane   from '../TimelineEditor/components/TrackLane.vue'
import HuePicker   from '../Production/components/HuePicker.vue'
import { useEditorViewport } from '../TimelineEditor/view/useEditorViewport'
import type { ClipDisplay, EditorClip, EditorTrack, NameDisplay } from '../../types/timeline'
import { makeDemoClip, makeDemoTimeline } from './demoTimeline'

/**
 * What a track type actually controls, wired to the real lane it controls.
 *
 * In the app these three values live on a track type and every track of that
 * type inherits them; here the switches write them onto one track, so a visitor
 * sees the same repaint an admin gets after saving the type.
 *
 * The header's own menu is live too — nothing on this page opens a menu whose
 * items do nothing.
 */
const { t } = useI18n()

const timeline  = makeDemoTimeline()
const ROW_HEIGHT = 64

// The lane is sized to the card instead of scrolling: this demo is about how a
// clip is PAINTED, and a scrollbar here would only be something else to fiddle
// with. Falls back to a sane width for the first frame, before the measure.
const { canvasRef, viewport, updateViewport } = useEditorViewport()
provide('editor-viewport', viewport)

onMounted(updateViewport)

const SPAN       = 1500                                                   // frames on screen
const pxPerFrame = computed(() => (viewport.value.width || 720) / SPAN)

const clipDisplay = ref<ClipDisplay>('normal')
const nameDisplay = ref<NameDisplay>('normal')
const hue         = ref(305)

const clipOptions = computed<Array<{ value: ClipDisplay; label: string }>>(() => [
  { value: 'normal',      label: t('trackTypes.settings.clipNormal') },
  { value: 'zebra',       label: t('trackTypes.settings.clipZebra') },
  { value: 'border',      label: t('trackTypes.settings.clipBorder') },
  { value: 'transparent', label: t('trackTypes.settings.clipTransparent') },
])

const nameOptions = computed<Array<{ value: NameDisplay; label: string }>>(() => [
  { value: 'normal',    label: t('trackTypes.settings.nameNormal') },
  { value: 'emphasize', label: t('trackTypes.settings.nameEmphasize') },
  { value: 'stretch',   label: t('trackTypes.settings.nameStretch') },
])

// ── The track ─────────────────────────────────────────────────────────────────
const TRACK_ID = 'trk-preview'

const initialClips = (): EditorClip[] => [
  makeDemoClip(TRACK_ID, { position: 40,  mediaStart: 0, end: 360, label: 'Overture' }),
  makeDemoClip(TRACK_ID, { position: 480, mediaStart: 0, end: 300, label: 'Verse' }),
  makeDemoClip(TRACK_ID, { position: 860, mediaStart: 0, end: 520, label: 'Finale bed' }),
]

const clips    = ref<EditorClip[]>(initialClips())
const name     = ref('Music')
const muted    = ref(false)
const locked   = ref(false)
const selected = ref(false)
const deleted  = ref(false)
const volume   = ref(1)      // client-local in the editor too — never persisted

const track = computed<EditorTrack>(() => ({
  id: TRACK_ID, timelineId: timeline.id, typeId: 'preview-type', sourceId: null,
  name: name.value, icon: null, mode: 'clip', sortOrder: 0,
  isMuted: muted.value, isLocked: locked.value,
  createdAt: timeline.createdAt,
  typeName: 'Playback', typeHue: hue.value, typeIcon: 'mdi:music-note-outline',
  clips: clips.value,
}))

function setClips(next: EditorClip[]): void {
  clips.value = [...next].sort((a, b) => a.position - b.position)
}

function patchClip(clip: EditorClip, fields: Partial<EditorClip>): void {
  setClips(clips.value.map(c => (c.id === clip.id ? { ...c, ...fields } : c)))
}

const NEW_CLIP_LENGTH = 240

/** Appends after the last clip, wrapping to the front rather than off-screen. */
function addClip(): void {
  const last  = clips.value[clips.value.length - 1]
  const after = last ? last.position + (last.end ?? 0) + 80 : 40
  const position = after + NEW_CLIP_LENGTH > SPAN ? 40 : after
  setClips([
    ...clips.value,
    makeDemoClip(TRACK_ID, { position, mediaStart: 0, end: NEW_CLIP_LENGTH, label: 'New clip' }),
  ])
}

function restore(): void {
  deleted.value = false
  setClips(initialClips())
  name.value = 'Music'
  muted.value = locked.value = selected.value = false
  volume.value = 1
}

// ── Renaming ──────────────────────────────────────────────────────────────────
const renameOpen = ref(false)
const renameClip = ref<EditorClip | null>(null)

const renameValue = computed(() => renameClip.value?.label ?? name.value)

function submitRename(value: string): void {
  if (renameClip.value) patchClip(renameClip.value, { label: value })
  else name.value = value
  renameOpen.value = false
}

function openRename(clip: EditorClip | null): void {
  renameClip.value = clip
  renameOpen.value = true
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
      <label class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-muted-foreground">{{ $t('trackTypes.settings.clipDisplay') }}</span>
        <SwitchTab v-model="clipDisplay" :options="clipOptions" class="border border-border" />
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-muted-foreground">{{ $t('trackTypes.settings.nameDisplay') }}</span>
        <SwitchTab v-model="nameDisplay" :options="nameOptions" class="border border-border" />
      </label>

      <label class="flex min-w-48 flex-1 flex-col gap-1.5">
        <span class="text-xs font-medium text-muted-foreground">{{ $t('trackTypes.color') }}</span>
        <HuePicker v-model="hue" class="h-9" />
      </label>
    </div>

    <!-- The editor's own header + lane, repainting from the switches above -->
    <div class="overflow-hidden rounded-xl border border-border bg-card">
      <EmptyState v-if="deleted" icon="mdi:layers-off-outline" class="py-10">
        {{ $t('editor.noTracks') }}
        <template #action>
          <Button variant="outline" size="sm" @click="restore">{{ $t('welcome.demo.reset') }}</Button>
        </template>
      </EmptyState>

      <div v-else class="flex">
        <div class="w-32 shrink-0 border-r border-border sm:w-40">
          <TrackHeader
            :track="track"
            :height="ROW_HEIGHT"
            :selected="selected"
            :muted="muted"
            :resizable="false"
            :volume="volume"
            @update:volume="volume = $event"
            @select="selected = !selected"
            @toggle-mute="muted = !muted"
            @toggle-lock="locked = !locked"
            @add-clip="addClip"
            @settings="openRename(null)"
            @delete="deleted = true"
          />
        </div>

        <div ref="canvasRef" class="flex-1 overflow-hidden">
          <TrackLane
            :track="track"
            :timeline="timeline"
            :px-per-frame="pxPerFrame"
            :height="ROW_HEIGHT"
            :selected="selected"
            :muted="muted"
            :name-display="nameDisplay"
            :clip-display="clipDisplay"
            @select="selected = !selected"
            @edit-clip="openRename($event)"
            @delete-clip="setClips(clips.filter(c => c.id !== $event.id))"
            @crop-clip="patchClip($event.clip, $event.fields)"
            @move-clip="patchClip($event.clip, { position: $event.position })"
          />
        </div>
      </div>
    </div>

    <PromptDialog
      v-model:open="renameOpen"
      :title="renameClip ? $t('editor.editClipDialog.title') : $t('editor.trackDialog.title')"
      :label="renameClip ? $t('editor.clipLabel') : $t('editor.trackName')"
      :submit-label="$t('editor.save')"
      :cancel-label="$t('editor.cancel')"
      :initial-value="renameValue"
      @submit="submitRename"
    />
  </div>
</template>
