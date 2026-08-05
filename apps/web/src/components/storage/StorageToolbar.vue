<script setup>
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import { Button, IconButton } from '@starling/ui'
import StorageBreadcrumb from './StorageBreadcrumb.vue'
import { useStorage } from './storage.js'

/** Where you are, how to get back, and the two ways to add something. */
const ACCEPTED = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/x-m4a',
].join(',')

const { browser, actions, upload } = useStorage()
const { crumbs, canGoBack, canGoForward, goBack, goForward, goToCrumb } = browser

const fileInput = ref(null)

function onPick(e) {
  upload.uploadFiles([...e.target.files])
  e.target.value = ''
}
</script>

<template>
  <div class="flex flex-col lg:flex-row items-start justify-start lg:justify-between gap-2">
    <div class="flex items-center gap-1.5">
      <IconButton
        icon="mdi:arrow-left"
        class="p-1 hover:text-foreground hover:bg-muted"
        :disabled="!canGoBack"
        :title="$t('storage.back')"
        @click="goBack()"
      />
      <IconButton
        icon="mdi:arrow-right"
        class="p-1 hover:text-foreground hover:bg-muted"
        :disabled="!canGoForward"
        :title="$t('storage.forward')"
        @click="goForward()"
      />
      <StorageBreadcrumb :crumbs="crumbs" @navigate="goToCrumb($event)" />
    </div>

    <div class="flex items-center gap-2">
      <Button size="sm" variant="outline" @click="actions.newFolder()">
        <Icon icon="mdi:folder-plus-outline" class="mr-1.5 text-base" />
        {{ $t('storage.newFolder') }}
      </Button>
      <Button size="sm" @click="fileInput.click()">
        <Icon icon="mdi:upload" class="mr-1.5 text-base" />
        {{ $t('storage.upload.label') }}
      </Button>
      <input ref="fileInput" type="file" class="sr-only" multiple :accept="ACCEPTED" @change="onPick" />
    </div>
  </div>
</template>
