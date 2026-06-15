import { ref } from 'vue'
import { io } from 'socket.io-client'

// Module-level state — shared across all callers
const messages    = ref([])
const onlineUsers = ref([])
const connected   = ref(false)

let socket = null

export function useSocket() {
  function connect() {
    if (socket?.connected) return

    socket = io({ path: '/socket', withCredentials: true })

    socket.on('connect',    () => { connected.value = true })
    socket.on('disconnect', () => { connected.value = false })

    socket.on('history', (history) => {
      messages.value = history
    })

    socket.on('online', (users) => {
      onlineUsers.value = users
    })

    socket.on('message:new', (msg) => {
      messages.value = [...messages.value, msg]
    })

    socket.on('user:joined', (user) => {
      if (!onlineUsers.value.some(u => u.id === user.id)) {
        onlineUsers.value = [...onlineUsers.value, user]
      }
    })

    socket.on('user:left', (user) => {
      onlineUsers.value = onlineUsers.value.filter(u => u.id !== user.id)
    })

    socket.on('connect_error', (err) => {
      console.error('[socket]', err.message)
    })
  }

  function disconnect() {
    socket?.disconnect()
    socket      = null
    connected.value   = false
    messages.value    = []
    onlineUsers.value = []
  }

  function sendMessage(text) {
    return new Promise((resolve, reject) => {
      if (!socket?.connected) { reject(new Error('Not connected')); return }
      socket.emit('message:send', text, (result) => {
        'error' in result ? reject(new Error(result.error)) : resolve()
      })
    })
  }

  return { messages, onlineUsers, connected, connect, disconnect, sendMessage }
}
