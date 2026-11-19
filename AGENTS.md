# AGENTS.md

## GitHub 账号（强制）

本仓库一律用**仓库所属账号**操作：commit 作者、push 凭据、提 PR 都用它。

- 本机 keychain 的 `github.com` 下存着两条不同账号的凭据。另一条对 `dsh-cursor-toolkit` **只有读权限**，用它 push 会得到 `Permission to ... denied` / `403`，不要回退到它。
- 三条本地配置已 pin 好，正常 `git push` 就会命中正确账号：
  - `remote.origin.url` = `https://<账号>@github.com/<账号>/dsh-cursor-toolkit.git`（URL 里带用户名，keychain 才能精确匹配到该账号的 token）
  - `credential.username` = `<账号>`
  - `user.name` / `user.email` = 该账号及其邮箱 —— **不要用全局身份**（全局是另一个工作账号 `chenkangxi <chenkangxi@sailvan.com>`）
- 换机器或重新 clone 时补上同样三条：

  ```sh
  git remote set-url origin "https://<账号>@github.com/<账号>/dsh-cursor-toolkit.git"
  git config --local credential.username "<账号>"
  git config --local user.name "<账号>"
  git config --local user.email "<账号>@163.com"
  ```

- 网络：本机到 github.com 的 22 / 443 端口都被重置（`kex_exchange_identification: Connection reset by peer`），**只能用 HTTPS**；查 GitHub 走 `api.github.com` REST（本机没有 `gh` CLI）。
