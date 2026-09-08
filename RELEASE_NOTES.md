# v0.1.0 — Initial public release

## English

### Included

- Cloudflare-native password manager for Workers, D1, and R2 or KV, with a Web Vault and Bitwarden-compatible personal vault endpoints.
- Personal vault editing and synchronization, attachments, Sends, import/export, offline unlock, and basic organization/collection sharing within the documented support scope.
- Account security controls, device/session management, administrative audit events, and backup/restore with R2, S3, and WebDAV destinations.
- Automated type, lint, API/Web/runtime, build, dependency-audit, secret-scan, and CodeQL checks. Official Bitwarden CLI compatibility checks now run against an isolated local Worker in CI.
- Private vulnerability reporting, structured issue forms, contribution guidance, and weekly Dependabot updates.
- Linear-time trailing-dot normalization, certificate verification in integration tests, and pinned workflow actions address findings from the initial CodeQL scan.

### Upgrade notes

- Public versioning starts at `0.1.0`; earlier `1.0.0` application strings were development placeholders. This change does not reset data, rewrite migrations, or change the backup archive format or advertised Bitwarden protocol version.
- Existing development deployments should take a full backup and review the operations guide before updating. Keep `DATA_ENCRYPTION_SECRET` backed up separately.
- The vulnerable transitive `cookie@0.6.0` dependency is replaced with `0.7.2` through a targeted SvelteKit override.

### Validation and limitations

- Local validation passed on Node.js 26.8.1: type/config/migration checks, lint, 258 API tests, 4 workerd tests, 152 Web tests, and production build. The dependency audit reports no known vulnerabilities.
- Official Bitwarden CLI 2026.7.0 passed the extended local compatibility suite, including two-profile sync, item lifecycle, attachments, Sends, and lock/unlock with certificate verification enabled.
- Android, iOS, desktop, browser-extension, and deployed Cloudflare acceptance remain pending for this release candidate.
- Organization support covers basic sharing, not enterprise parity. SSO, SCIM, emergency access, billing, and mail-delivery workflows are outside the current scope.
- Automated security checks do not constitute an independent security audit.

---

## 中文

### 包含内容

- 面向 Cloudflare Workers、D1、R2 或 KV 的密码管理器，提供 Web 保险库与兼容 Bitwarden 的个人保险库接口。
- 支持个人条目编辑与同步、附件、Send、导入导出、离线解锁，以及支持范围内的基础组织与集合共享。
- 提供账户安全控制、设备与会话管理、管理审计，以及面向 R2、S3、WebDAV 的备份恢复。
- 配置类型检查、lint、API/Web/运行时测试、构建、依赖审计、密钥扫描和 CodeQL；官方 Bitwarden CLI 兼容性检查接入 CI，使用隔离的本地 Worker。
- 增加私密漏洞报告渠道、结构化问题表单、贡献指南及每周 Dependabot 更新。
- 针对首轮 CodeQL 告警，将域名末尾点号处理改为线性扫描、保留集成测试的证书验证，并固定工作流 Actions 的提交版本。

### 升级说明

- 公开版本从 `0.1.0` 开始；此前应用中的 `1.0.0` 为开发占位值。本次版本调整不重置数据、不重写迁移，也不改变备份格式或对外声明的 Bitwarden 协议版本。
- 已部署开发版本的用户应先完整备份并阅读运维指南，单独备份 `DATA_ENCRYPTION_SECRET`。
- 通过针对 SvelteKit 的 override，将存在漏洞的间接依赖 `cookie@0.6.0` 替换为 `0.7.2`。

### 验证与限制

- 在 Node.js 26.8.1 上通过本地类型、配置、迁移检查、lint、258 个 API 测试、4 个 workerd 测试、152 个 Web 测试及生产构建；依赖审计未发现已知漏洞。
- 官方 Bitwarden CLI 2026.7.0 已通过扩展本地兼容性测试，覆盖双配置同步、条目生命周期、附件、Send 与锁定解锁，测试全程保留证书验证。
- 本候选版本的 Android、iOS、桌面端、浏览器扩展及已部署 Cloudflare 环境验收仍待完成。
- 组织功能面向基础共享，不承诺企业功能对等；SSO、SCIM、紧急访问、计费和邮件投递流程不在当前支持范围内。
- 自动化安全检查不等同于独立安全审计。
