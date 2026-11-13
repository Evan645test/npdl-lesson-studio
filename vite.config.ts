import { defineConfig } from 'vitest/config';
export default defineConfig({
  base: './', server: { host: '127.0.0.1', port: 5193, strictPort: true },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
  build: { sourcemap: false },
  // R38：課綱等大型 JSON 以 JSON.parse 字串輸出，瀏覽器解析比物件字面值快（課綱約 940KB，壓縮後約 52KB）。
  json: { stringify: true },
});
