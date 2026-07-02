<script setup>
import ListCard   from './ListCard.vue'
import ListHeader from './ListHeader.vue'
import Skeleton   from './Skeleton.vue'

defineProps({
  title:        { type: String,  required: true },
  loading:      { type: Boolean, default: false },
  error:        { type: String,  default: '' },
  count:        { type: Number,  default: 0 },
  skeletonRows: { type: Number,  default: 3 },
})
</script>

<template>
  <ListCard>
    <ListHeader :title="title">
      <template #action>
        <slot name="header-action">
          <span
            v-if="!loading && count"
            class="text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md"
          >{{ count }}</span>
        </slot>
      </template>
    </ListHeader>

    <ul v-if="loading" class="divide-y divide-border">
      <li v-for="i in skeletonRows" :key="i" class="flex items-center gap-3 px-4 py-3">
        <slot name="skeleton">
          <Skeleton class="size-4 rounded shrink-0" />
          <Skeleton class="h-4 flex-1 max-w-xs rounded" />
          <Skeleton class="size-7 rounded-md ml-auto" />
          <Skeleton class="size-7 rounded-md" />
        </slot>
      </li>
    </ul>

    <p v-else-if="error" class="px-4 py-4 text-sm text-destructive">{{ error }}</p>

    <div v-else-if="count === 0" class="py-14 text-center text-sm text-muted-foreground">
      <slot name="empty" />
    </div>

    <ul v-else class="divide-y divide-border">
      <slot />
    </ul>
  </ListCard>
</template>
