if (process.argv.includes("--sandbox-worker")) {
  const worker = await import("./sandbox/SandboxWorkerMain")
  await worker.startSandboxWorker()
} else {
  const server = await import("./ServerMain")
  await server.startAgentServer()
}

export {}
