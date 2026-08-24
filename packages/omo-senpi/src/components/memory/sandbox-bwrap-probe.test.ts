import { describe, expect, test } from "bun:test"
import { chmod, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { classifyBwrapSmoke, probeBwrapUsability } from "./sandbox-platform"

describe("classifyBwrapSmoke", () => {
  test("#given a smoke child that exited 0 #when classified #then bwrap is usable", () => {
    expect(classifyBwrapSmoke({ exitCode: 0, timedOut: false, stderr: "" })).toEqual({ usable: true })
  })

  test("#given a smoke child that failed during user-namespace setup #when classified #then it is unusable and the reason carries the stderr", () => {
    const usability = classifyBwrapSmoke({
      exitCode: 1,
      timedOut: false,
      stderr: "bwrap: setting up uid map: Permission denied\n",
    })

    expect(usability.usable).toBe(false)
    if (!usability.usable) expect(usability.reason).toContain("setting up uid map: Permission denied")
  })

  test("#given a smoke child that could not be spawned at all #when classified #then it is unusable with the spawn error", () => {
    const usability = classifyBwrapSmoke({
      exitCode: null,
      timedOut: false,
      errorMessage: "spawn /usr/bin/bwrap ENOENT",
      stderr: "",
    })

    expect(usability.usable).toBe(false)
    if (!usability.usable) expect(usability.reason).toContain("spawn /usr/bin/bwrap ENOENT")
  })

  test("#given a smoke child that hung past the timeout #when classified #then it is unusable and the reason names the timeout", () => {
    const usability = classifyBwrapSmoke({ exitCode: null, timedOut: true, stderr: "" })

    expect(usability.usable).toBe(false)
    if (!usability.usable) expect(usability.reason).toContain("timed out")
  })
})

describe.skipIf(process.platform === "win32")("probeBwrapUsability", () => {
  test("#given an executable whose behavior changes after the first probe #when probed repeatedly #then the first verdict is memoized per path", async () => {
    // given
    const binDir = await mkdtemp(join(tmpdir(), "omo-bwrap-probe-"))
    const executable = join(binDir, "bwrap")
    await writeFile(executable, "#!/bin/sh\nexit 0\n")
    await chmod(executable, 0o755)

    // when
    const first = probeBwrapUsability(executable)
    await writeFile(executable, "#!/bin/sh\nexit 1\n")
    const second = probeBwrapUsability(executable)

    // then: a fresh classification would now be unusable, so a cached verdict is the only
    // way `second` can still report usable.
    expect(first).toEqual({ usable: true })
    expect(second).toEqual({ usable: true })
  }, 30_000)

  test("#given a path that is not an executable #when probed #then it is unusable with the spawn failure", () => {
    // when
    const usability = probeBwrapUsability(join(tmpdir(), "omo-bwrap-probe-missing-binary"))

    // then
    expect(usability.usable).toBe(false)
  })
})
