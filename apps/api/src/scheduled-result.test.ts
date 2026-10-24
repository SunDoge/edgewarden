import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./services/backup/scheduler", () => ({
  runScheduledBackupIfDue: vi.fn(),
}));
vi.mock("./services/maintenance", () => ({ runScheduledMaintenance: vi.fn() }));
import { runScheduledTasks } from "./index";
import { runScheduledBackupIfDue } from "./services/backup/scheduler";
import { runScheduledMaintenance } from "./services/maintenance";
const env = {} as CloudflareBindings;
beforeEach(() => vi.resetAllMocks());
describe("scheduled task result summaries", () => {
  it("reports a busy maintenance lease as skipped", async () => {
    vi.mocked(runScheduledBackupIfDue).mockResolvedValue({
      due: 0,
      succeeded: 0,
      failed: 0,
      busy: true,
    });
    expect(await runScheduledTasks(env)).toMatchObject({
      status: "skipped",
      message: expect.stringContaining("本次跳过"),
    });
    expect(runScheduledMaintenance).not.toHaveBeenCalled();
  });
  it("reports actual backup and maintenance totals", async () => {
    vi.mocked(runScheduledBackupIfDue).mockResolvedValue({
      due: 3,
      succeeded: 3,
      failed: 0,
      busy: false,
    });
    vi.mocked(runScheduledMaintenance).mockResolvedValue({
      refreshTokens: 2,
      deviceTrustTokens: 0,
      webauthnChallenges: 1,
      attachmentDownloadTokens: 0,
      attachmentUploads: 0,
      authRequests: 0,
      loginAttempts: 0,
      expiredInvites: 1,
      purgedAttachments: 0,
      purgedCiphers: 0,
      purgedSends: 0,
      purgedOrganizations: 0,
      purgedUsers: 0,
      blobGc: { deleted: 2, referenced: 0, deferred: 0, contended: 0 },
    });
    const result = await runScheduledTasks(env);
    expect(result.status).toBe("ok");
    expect(result.message).toContain("成功 3 个");
    expect(result.message).toContain("清理临时记录 3 条");
    expect(result.message).toContain("回收文件 2 个");
  });
  it("still throws failures after attempting maintenance", async () => {
    vi.mocked(runScheduledBackupIfDue).mockRejectedValue(
      new Error("backup offline"),
    );
    vi.mocked(runScheduledMaintenance).mockRejectedValue(
      new Error("maintenance offline"),
    );
    await expect(runScheduledTasks(env)).rejects.toThrow(AggregateError);
    expect(runScheduledMaintenance).toHaveBeenCalledOnce();
  });
});
