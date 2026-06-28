declare module '@starling/ui' {
  export const Avatar: import('vue').DefineComponent<any, any, any>
  export const Image:  import('vue').DefineComponent<any, any, any>
  export const Toast:  import('vue').DefineComponent<any, any, any>
  export function useToast(): any
}

declare module '@starling/ui/*' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<any, any, any>
  export default component
}
