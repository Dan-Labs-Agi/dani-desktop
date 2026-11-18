import type { ChildProcessWithoutNullStreams } from "node:child_process";

/** EOF retires only the MCP loop, preserving its browser daemon and Chrome. */
export function retireBrowserTransport(child: ChildProcessWithoutNullStreams): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      child.off("exit", finish);
      resolve(child.exitCode !== null || child.signalCode !== null);
    };
    timer = setTimeout(() => {
      // A kill request is not proof. Wait for the actual exit, including on Windows.
      try { child.kill("SIGKILL"); } catch {}
      timer = setTimeout(finish, 1_000);
    }, 1_000);
    child.once("exit", finish);
    if (child.exitCode !== null || child.signalCode !== null) finish();
    else child.stdin.end();
  });
}
