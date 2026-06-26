import { expect, test } from "@playwright/test";
import { bootDaemon, type DaemonHandle } from "./daemon-fixture";

/**
 * Auto-generate description e2e (testplan §2, T1-T8). Covers the
 * GenerateDescriptionButton wired into AgentForm (S7) and WorkflowForm (S8).
 * No daemon RPC is involved in the generation itself (STATE §9/§10) — this
 * suite still boots the real daemon since the rest of the builder flow
 * (project creation, save) depends on it.
 */

let daemon: DaemonHandle;

test.beforeEach(async () => {
  daemon = await bootDaemon();
});

test.afterEach(async () => {
  await daemon.stop();
});

async function createProjectAndOpenAgentForm(page: import("@playwright/test").Page) {
  await page.goto(daemon.url);
  await page.getByRole("button", { name: "+ Tạo dự án" }).first().click();
  await page.getByPlaceholder("My API Service").fill("e2e-gendesc");
  await page.getByPlaceholder("/home/me/code/my-service").fill(daemon.projectRoot);
  await expect(page.getByText("✓ Thư mục tồn tại")).toBeVisible();
  await page.getByRole("button", { name: "Tạo dự án", exact: true }).click();
  await expect(page.getByRole("button", { name: "+ Thêm agent" }).first()).toBeVisible();
  await page.getByRole("button", { name: "+ Thêm agent" }).first().click();
  await expect(page.getByText("Agent builder")).toBeVisible();
}

test("T1 — empty description, click generate -> fills directly (no confirm dialog)", async ({ page }) => {
  await createProjectAndOpenAgentForm(page);

  await page.getByPlaceholder("code-reviewer").fill("code-reviewer");
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page.locator("textarea").fill("You are the independent code reviewer.");

  await page.getByRole("button", { name: "Tạo mô tả tự động" }).click();

  // No confirm dialog should appear.
  await expect(page.getByText("Thay thế mô tả?")).not.toBeVisible();
  await expect(page.getByPlaceholder("Independent reviewer…")).toHaveValue(/Agent that uses Read/);
});

test("T2 — non-empty description, click generate -> confirm dialog; Hủy leaves original text untouched", async ({
  page,
}) => {
  await createProjectAndOpenAgentForm(page);

  await page.getByPlaceholder("code-reviewer").fill("code-reviewer");
  await page.getByPlaceholder("Independent reviewer…").fill("My custom description");
  await page.locator("textarea").fill("You are the independent code reviewer.");

  await page.getByRole("button", { name: "Tạo mô tả tự động" }).click();

  await expect(page.getByText("Thay thế mô tả?")).toBeVisible();
  await expect(page.getByText("Văn bản mô tả hiện tại sẽ được thay thế — tiếp tục?")).toBeVisible();

  const confirmDialog = page.locator("h2", { hasText: "Thay thế mô tả?" }).locator("xpath=(ancestor::div[contains(@class, 'fixed')])[last()]");
  await confirmDialog.getByRole("button", { name: "Hủy" }).click();

  await expect(page.getByText("Thay thế mô tả?")).not.toBeVisible();
  await expect(page.getByPlaceholder("Independent reviewer…")).toHaveValue("My custom description");
});

test("T3 — non-empty description, click generate, Thay thế -> description replaced", async ({ page }) => {
  await createProjectAndOpenAgentForm(page);

  await page.getByPlaceholder("code-reviewer").fill("code-reviewer");
  await page.getByPlaceholder("Independent reviewer…").fill("My custom description");
  await page.locator("textarea").fill("You are the independent code reviewer.");

  await page.getByRole("button", { name: "Tạo mô tả tự động" }).click();
  await expect(page.getByText("Thay thế mô tả?")).toBeVisible();

  await page.getByRole("button", { name: "Thay thế" }).click();

  await expect(page.getByText("Thay thế mô tả?")).not.toBeVisible();
  const value = await page.getByPlaceholder("Independent reviewer…").inputValue();
  expect(value).not.toBe("My custom description");
  expect(value.length).toBeGreaterThan(0);
});

test("T4 — rapid double-click only applies once, no duplicate/garbled state", async ({ page }) => {
  await createProjectAndOpenAgentForm(page);

  await page.getByPlaceholder("code-reviewer").fill("code-reviewer");
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page.locator("textarea").fill("You are the independent code reviewer.");

  const generateButton = page.getByRole("button", { name: "Tạo mô tả tự động" });
  await Promise.all([generateButton.click(), generateButton.click()]);

  // Each click's handler runs synchronously to completion (busyRef re-entrancy
  // guard only protects against truly overlapping/async invocations — see
  // STATE §10.7 EC-5 note that there is no async window here). The first click
  // applies the generated text directly (description was empty); since that
  // updates the description synchronously before the second click's handler
  // reads `currentDescription`, the second click may legitimately see a
  // non-empty description and open the confirm dialog instead of re-applying.
  // Either way, the value must never be duplicated/concatenated/garbled.
  const confirmVisible = await page.getByText("Thay thế mô tả?").isVisible();
  if (confirmVisible) {
    const confirmDialog = page.locator("h2", { hasText: "Thay thế mô tả?" }).locator("xpath=(ancestor::div[contains(@class, 'fixed')])[last()]");
    await confirmDialog.getByRole("button", { name: "Hủy" }).click();
  }

  const value = await page.getByPlaceholder("Independent reviewer…").inputValue();
  expect(value).toMatch(/^Agent that uses Read/);
  // No accidental doubling/concatenation of the generated string.
  expect(value.match(/Agent that uses Read/g)?.length).toBe(1);
});

test("T5 — Workflow Builder generates 'Command that ...' phrasing, no tools-related text", async ({ page }) => {
  await page.goto(daemon.url);
  await page.getByRole("button", { name: "+ Tạo dự án" }).first().click();
  await page.getByPlaceholder("My API Service").fill("e2e-gendesc-wf");
  await page.getByPlaceholder("/home/me/code/my-service").fill(daemon.projectRoot);
  await expect(page.getByText("✓ Thư mục tồn tại")).toBeVisible();
  await page.getByRole("button", { name: "Tạo dự án", exact: true }).click();

  await page.getByRole("button", { name: "+ Thêm workflow" }).first().click();
  await expect(page.getByText("Workflow builder")).toBeVisible();

  await page.getByPlaceholder("analyze").fill("analyze");
  await page.locator("textarea").fill("Run the full analysis pipeline");

  await page.getByRole("button", { name: "Tạo mô tả tự động" }).click();

  const value = await page
    .getByPlaceholder("3 BA agents research requirements, then synthesize")
    .inputValue();
  expect(value).toMatch(/^Command that /);
  expect(value).not.toMatch(/uses .* to/i);
});

test("T6 — generated description is editable and survives Save + Publish + write to disk", async ({ page }) => {
  const { existsSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  await createProjectAndOpenAgentForm(page);

  await page.getByPlaceholder("code-reviewer").fill("code-reviewer");
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page.locator("textarea").fill("You are the independent code reviewer.");

  await page.getByRole("button", { name: "Tạo mô tả tự động" }).click();

  // Edit the generated text further, like any normal manually-typed field.
  const descInput = page.getByPlaceholder("Independent reviewer…");
  const generated = await descInput.inputValue();
  await descInput.fill(`${generated} (edited)`);

  await page.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByText("Agent builder")).not.toBeVisible();

  // Re-open the form: edited generated description is still there (plain editable state, AC-6).
  await page.getByText("code-reviewer").first().click();
  await expect(descInput).toHaveValue(new RegExp(`${generated.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(edited\\)$`));
  await page.getByRole("button", { name: "Hủy" }).click();

  // Publish -> diff -> write to disk; confirm the edited description lands verbatim in the file (AC-8).
  await page.getByRole("button", { name: "Xuất bản ▸" }).click();
  await page.getByRole("button", { name: "Xem trước thay đổi" }).click();
  await page.getByRole("button", { name: "Ghi xuống đĩa" }).click();
  await expect(page.getByText(/file tạo mới/)).toBeVisible();

  const agentPath = join(daemon.projectRoot, ".claude", "agents", "code-reviewer.md");
  expect(existsSync(agentPath)).toBe(true);
  const content = readFileSync(agentPath, "utf-8");
  expect(content).toContain(`description: ${generated} (edited)`);
});

test("T7 — generate icon remains clickable when daemon is disconnected", async ({ page }) => {
  await createProjectAndOpenAgentForm(page);

  await page.getByPlaceholder("code-reviewer").fill("code-reviewer");
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page.locator("textarea").fill("You are the independent code reviewer.");

  // Force the daemon heartbeat (ping RPC) to fail so the red disconnect banner appears.
  await page.route("**/rpc", async (route) => {
    const body = route.request().postDataJSON() as { method?: string };
    if (body?.method === "ping") {
      await route.abort();
      return;
    }
    await route.continue();
  });

  await expect(page.getByText("daemon mất kết nối")).toBeVisible({ timeout: 10_000 });

  const generateButton = page.getByRole("button", { name: "Tạo mô tả tự động" });
  await expect(generateButton).toBeEnabled();
  await generateButton.click();

  await expect(page.getByPlaceholder("Independent reviewer…")).toHaveValue(/Agent that uses Read/);
});

test("T8 — no network requests are fired when clicking generate", async ({ page }) => {
  await createProjectAndOpenAgentForm(page);

  await page.getByPlaceholder("code-reviewer").fill("code-reviewer");
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page.locator("textarea").fill("You are the independent code reviewer.");

  const requestsDuringClick: string[] = [];
  const onRequest = (req: import("@playwright/test").Request) => requestsDuringClick.push(req.url());
  page.on("request", onRequest);

  await page.getByRole("button", { name: "Tạo mô tả tự động" }).click();
  await expect(page.getByPlaceholder("Independent reviewer…")).toHaveValue(/Agent that uses Read/);

  page.off("request", onRequest);
  expect(requestsDuringClick).toHaveLength(0);
});
