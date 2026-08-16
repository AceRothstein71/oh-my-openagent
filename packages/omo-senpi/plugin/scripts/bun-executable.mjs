export function resolveBunExecutable(platform = process.platform) {
  return platform === "win32" ? "bun.exe" : "bun"
}
