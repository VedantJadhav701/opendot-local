export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installFetchLogger, pruneNetLog } = await import("./server/net/netlog");
    installFetchLogger();
    pruneNetLog();
    const { boot } = await import("./server/boot");
    boot();
  }
}
