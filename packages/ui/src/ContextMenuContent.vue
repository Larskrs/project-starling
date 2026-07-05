<script setup>
import { ContextMenuPortal, ContextMenuContent } from 'radix-vue'

// Right-click menu: positions at the cursor (unlike DropdownMenuContent, which
// anchors to a trigger).
//
// Animation is injected at runtime rather than declared in a <style> block: the
// UI package's compiled stylesheet (dist/ui.css) isn't imported by the host app,
// so a <style> block here would never load. Injecting once keeps context-menu
// motion self-contained in this file and independent of that CSS wiring.
//   • cm-open  — scale/fade in, growing from the cursor via Radix's origin var
//   • cm-arm   — holds pointer-events:none for 200ms (step-end) so a click
//                landing as the menu opens can't instantly activate an item
if (typeof document !== 'undefined' && !document.getElementById('cm-content-anim')) {
  const style = document.createElement('style')
  style.id = 'cm-content-anim'
  style.textContent = `
    [role="menu"].cm-content[data-state="open"] {
      transform-origin: var(--radix-context-menu-content-transform-origin);
      animation: cm-open 0.2s ease, cm-arm 0.2s step-end;
    }
    [role="menu"].cm-content[data-state="closed"] { animation: cm-close 0.08s ease forwards; }
    @keyframes cm-open  { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
    @keyframes cm-close { from { opacity: 1; } to { opacity: 0; } }
    @keyframes cm-arm   { from { pointer-events: none; } to { pointer-events: auto; } }
  `
  document.head.appendChild(style)
}

defineProps({
  collisionPadding: { type: Number, default: 8 },
})
</script>

<template>
  <ContextMenuPortal>
    <ContextMenuContent
      :collision-padding="collisionPadding"
      class="cm-content z-[200] bg-background min-w-44 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl py-1 outline-none"
    >
      <slot />
    </ContextMenuContent>
  </ContextMenuPortal>
</template>
