/// <reference types="vite/client" />

/**
 * This app's own SFCs still carry plain-JS `<script setup>` blocks, so they
 * have no inferable public type. Giving them real types means migrating each
 * SFC to `lang="ts"` and type-checking with vue-tsc.
 *
 * (@starling/ui's components do get real declarations — that package emits
 * them with vue-tsc at build time.)
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
  export default component
}

/**
 * Component subpaths (`@starling/ui/Button`) resolve to `dist/Button.vue.d.ts`,
 * which the package's `./*` export condition doesn't name. Real declarations
 * still win where the path matches — this only catches what's left.
 */
declare module '@starling/ui/*'
