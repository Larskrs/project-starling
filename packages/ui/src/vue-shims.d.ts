/**
 * The components in this package are plain-JS `<script setup>` SFCs, so tsc
 * can't derive a type for them. They resolve to a permissive component type,
 * which is enough for index.ts to re-export them; real prop/emit types would
 * need each SFC on `lang="ts"` and vue-tsc doing the emit.
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
  export default component
}
