/** 由 tsup 在构建时注入；开发模式 (tsx) 下不存在，需用 typeof 判断 */
declare const __APP_VERSION__: string | undefined
declare const __WEB_INDEX_HTML__: string | undefined
declare const __WEB_SW_JS__: string | undefined
