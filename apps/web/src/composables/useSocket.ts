import { ref } from 'vue'
import { io, type Socket } from 'socket.io-client'

export interface ChatUser {
  id: string
  firstName?: string
  lastName?: string
  profileImageId?: string | null
}

export interface ChatMessage {
  id: string
  text: string
  userId: string
  createdAt: string
  attachments?: unknown[]
}

/** Acknowledgement the server sends back for message:send. */
type SendAck = { error: string } | Record<string, never>

// Module-level state — shared across all callers
const messages    = ref<ChatMessage[]>([])
const onlineUsers = ref<ChatUser[]>([])
const connected   = ref(false)

let socket: Socket | null = null

export function useSocket() {
  function connect(): void {
    if (socket?.connected) return

    socket = io({ path: '/socket', withCredentials: true })

    socket.on('connect',    () => { connected.value = true })
    socket.on('disconnect', () => { connected.value = false })

    socket.on('history', (history: ChatMessage[]) => {
      messages.value = history
    })

    socket.on('online', (users: ChatUser[]) => {
      onlineUsers.value = users
    })

    socket.on('message:new', (msg: ChatMessage) => {
      messages.value = [...messages.value, msg]
    })

    socket.on('user:joined', (user: ChatUser) => {
      if (!onlineUsers.value.some(u => u.id === user.id)) {
        onlineUsers.value = [...onlineUsers.value, user]
      }
    })

    socket.on('user:left', (user: ChatUser) => {
      onlineUsers.value = onlineUsers.value.filter(u => u.id !== user.id)
    })

    socket.on('connect_error', (err: Error) => {
      console.error('[socket]', err.message)
    })
  }

  function disconnect(): void {
    socket?.disconnect()
    socket      = null
    connected.value   = false
    messages.value    = []
    onlineUsers.value = []
  }

  function sendMessage(text: string, attachments: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      const active = socket
      if (!active?.connected) { reject(new Error('Not connected')); return }
      active.emit('message:send', { text, attachments }, (result: SendAck) => {
        if ('error' in result && result.error) reject(new Error(result.error))
        else resolve()
      })
    })
  }

  return { messages, onlineUsers, connected, connect, disconnect, sendMessage }
}
