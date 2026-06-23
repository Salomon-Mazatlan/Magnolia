import { defineConfig } from 'vitest/config'

// Node-environment unit tests (the REFI-QDA serializer/deserializer live in
// the main process and have no DOM). Test files live under test/.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node'
  }
})
