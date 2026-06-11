import { handle } from '../ipc/router'
import type { GitService } from '../services/git-service'

/** Registers every git.* IPC method. */
export function registerGitFeature(git: GitService): void {
  handle('git.status', ({ root }) => git.status(root))

  handle('git.stage', async ({ root, paths }) => {
    await git.stage(root, paths)
    return { ok: true }
  })

  handle('git.unstage', async ({ root, paths }) => {
    await git.unstage(root, paths)
    return { ok: true }
  })

  handle('git.discard', async ({ root, paths }) => {
    await git.discard(root, paths)
    return { ok: true }
  })

  handle('git.commit', ({ root, message }) => git.commit(root, message))

  handle('git.log', async ({ root, path, limit }) => ({
    entries: await git.log(root, path, limit)
  }))

  handle('git.show', async ({ root, ref, path }) => ({
    content: await git.show(root, ref, path)
  }))

  handle('git.diffFile', ({ root, path, staged }) => git.diffFile(root, path, staged))

  handle('git.init', async ({ root }) => {
    await git.init(root)
    return { ok: true }
  })

  handle('git.ignoreAdd', ({ root, pattern }) => {
    git.ignoreAdd(root, pattern)
    return { ok: true }
  })
}
