import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'app',
  typescript: true,
  vue: true,
  // 使用 eslint-plugin-format 格式化 CSS / HTML / Markdown 等非 JS 文件
  formatters: {
    css: true,
    html: true,
    markdown: 'prettier',
  },
  ignores: [
    '**/dist/**',
    'package-lock.json',
  ],
}, {
  files: ['src/**/*.ts'],
  rules: {
    // CLI 程序需要直接输出到终端、主动退出进程
    'no-console': 'off',
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
  },
})
