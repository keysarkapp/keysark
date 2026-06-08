# sidecar 资源目录(占位)

生产构建前由 `pnpm --filter @keysark/desktop bundle:sidecar` 填充:
Next.js standalone 产物 + `launch.mjs` + `paths.mjs`。

dev(`KEYSARK_DESKTOP_URL` 指向运行中的 web server)不需要这些文件,
此 README 仅用于让 `tauri.conf.json` 的 `resources: ["sidecar/**/*"]` glob 有匹配项,
避免 tauri-build 因空目录报错。打包内容由 `.gitignore` 忽略。
