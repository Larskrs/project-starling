<script setup lang="ts">
import { ref, watch } from 'vue'
import { Input } from '@starling/ui'
import { framesToTC, tcToFrames } from '../lib/editorUtils'

/**
 * A frame-valued field that reads and writes timecode (HH:MM:SS:FF). A bare
 * number still works as a frame count.
 *
 * The model updates the moment the text parses, not on blur: pressing Enter
 * submits the surrounding dialog without the field ever losing focus, and the
 * value typed has to be the value saved. The text is re-formatted on blur.
 */
const props = withDefaults(defineProps<{
  frameRate: string | number
  min?: number
  max?: number
}>(), { min: 0, max: Infinity })

const model = defineModel<number>({ required: true })
const emit  = defineEmits<{ validity: [valid: boolean] }>()

const text    = ref('')
const invalid = ref(false)
let focused   = false

function format(): void {
  text.value = framesToTC(model.value ?? 0, props.frameRate)
}

// Outside changes (dialog reopened, "use playhead") re-render the text — but
// never under the caret while someone is typing.
watch([model, () => props.frameRate], () => { if (!focused) format() }, { immediate: true })

function setInvalid(value: boolean): void {
  if (invalid.value === value) return
  invalid.value = value
  emit('validity', !value)
}

function onInput(value: string): void {
  text.value = value
  const frames = tcToFrames(value, props.frameRate)
  if (frames === null || frames < props.min || frames > props.max) { setInvalid(true); return }
  setInvalid(false)
  model.value = frames
}

function onBlur(): void {
  focused = false
  if (!invalid.value) format()
}
</script>

<template>
  <Input
    :model-value="text"
    :class="invalid ? 'font-mono tabular-nums border-destructive' : 'font-mono tabular-nums'"
    autocomplete="off"
    spellcheck="false"
    @update:model-value="onInput(String($event ?? ''))"
    @focus="focused = true"
    @blur="onBlur"
  />
</template>
