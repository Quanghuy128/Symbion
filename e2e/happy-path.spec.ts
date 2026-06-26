import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { bootDaemon, type DaemonHandle } from "./daemon-fixture";

/**
 * Happy-path e2e (testplan §3.1 / STATE §9 beginner journey
 * S2 -> S3 -> S7 -> S8 -> S10 -> S11 -> S12), against a real built daemon + a
 * disposable temp project repo (never the real repo). Covers: create project
 * (typed path, not native picker) -> add an agent via the form tab (S7) ->
 * add a workflow/command via the form tab incl. the "[Chèn $ARGUMENTS]"
 * helper (S8) -> live preview render -> publish -> diff view -> write to
 * disk -> confirm both files exist on disk with the managed marker.
 */

let daemon: DaemonHandle;

test.beforeEach(async () => {
  daemon = await bootDaemon();
});

test.afterEach(async () => {
  await daemon.stop();
});

test("create project -> add agent + command -> live preview -> publish -> diff -> write to disk", async ({ page }) => {
  await page.goto(daemon.url);

  // S2 — empty state: exactly the two CTAs, no sidebar project rows yet selected.
  await expect(page.getByText("Chưa có dự án nào")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Tạo dự án" })).toBeVisible();
  await expect(page.getByRole("button", { name: "↧ Import .claude/ có sẵn" })).toBeVisible();

  // S3 — create project via TYPED path (no native picker in this flow).
  await page.getByRole("button", { name: "+ Tạo dự án" }).first().click();
  await page.getByPlaceholder("My API Service").fill("e2e-demo");
  await page.getByPlaceholder("/home/me/code/my-service").fill(daemon.projectRoot);

  // Live validatePath feedback.
  await expect(page.getByText("✓ Thư mục tồn tại")).toBeVisible();

  await page.getByRole("button", { name: "Tạo dự án", exact: true }).click();

  // Project now in sidebar + main area shows the two add buttons (empty project).
  await expect(page.getByRole("button", { name: "e2e-demo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Thêm agent" }).first()).toBeVisible();

  // No disk write yet from project creation beyond .symbion/store.json — confirm
  // the target repo's .claude/ does NOT exist before any publish (no silent write).
  expect(existsSync(join(daemon.projectRoot, ".claude"))).toBe(false);
  expect(existsSync(join(daemon.projectRoot, ".symbion", "store.json"))).toBe(true);

  // S7 — add an agent via the FORM tab.
  await page.getByRole("button", { name: "+ Thêm agent" }).first().click();
  await expect(page.getByText("Agent builder")).toBeVisible();
  await expect(page.getByText("Theo mô tả")).toBeVisible(); // form tab active by default

  await page.getByPlaceholder("code-reviewer").fill("code-reviewer");
  await page.getByPlaceholder("Independent reviewer…").fill("Independent reviewer agent");
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page.getByRole("button", { name: "Grep", exact: true }).click();
  await page.locator("textarea").fill("You are the independent code reviewer.");

  // Live preview pane renders the rendered Claude file content.
  await expect(page.getByText(".claude/agents/code-reviewer.md")).toBeVisible();
  await expect(page.locator("text=name: code-reviewer").first()).toBeVisible();

  await page.getByRole("button", { name: "Lưu" }).click();

  // Drawer closes after save; artifact now listed with a draft dot.
  await expect(page.getByText("Agent builder")).not.toBeVisible();
  await expect(page.getByText("code-reviewer")).toBeVisible();
  await expect(page.getByText("·draft")).toBeVisible();

  // Still nothing written into the target repo's .claude/ — saveArtifact only
  // touches .symbion/store.json (STATE §4/§5b).
  expect(existsSync(join(daemon.projectRoot, ".claude"))).toBe(false);

  // S8 — add a workflow/command via the FORM tab.
  await page.getByRole("button", { name: "+ Thêm workflow" }).first().click();
  await expect(page.getByText("Workflow builder")).toBeVisible();
  await expect(page.getByText("Theo mô tả")).toBeVisible(); // form tab active by default

  await page.getByPlaceholder("analyze").fill("analyze");
  await page
    .getByPlaceholder("3 BA agents research requirements, then synthesize")
    .fill("Research requirements, then synthesize");
  await page.locator("textarea").fill("Analyze the following request:");

  // Use the $ARGUMENTS helper button rather than typing it by hand, so the
  // test exercises the actual form affordance (not just the textarea).
  await page.getByRole("button", { name: "[Chèn $ARGUMENTS]" }).click();

  // Live preview pane renders the rendered Claude command file content.
  await expect(page.getByText(".claude/commands/analyze.md")).toBeVisible();
  await expect(page.locator("text=$ARGUMENTS").first()).toBeVisible();

  await page.getByRole("button", { name: "Lưu" }).click();

  // Drawer closes after save; command now listed with a draft dot.
  await expect(page.getByText("Workflow builder")).not.toBeVisible();
  await expect(page.getByText("/analyze")).toBeVisible();

  // Still nothing written into the target repo's .claude/ before publish.
  expect(existsSync(join(daemon.projectRoot, ".claude"))).toBe(false);

  // S10 — publish.
  await page.getByRole("button", { name: "Xuất bản ▸" }).click();
  await expect(page.getByRole("heading", { name: "Xuất bản" })).toBeVisible();
  // Claude target checked by default; proceed straight to diff preview.
  await page.getByRole("button", { name: "Xem trước thay đổi" }).click();

  // S11 — diff preview: both new files, no conflicts, write enabled.
  await expect(page.getByText(".claude/agents/code-reviewer.md")).toBeVisible();
  await expect(page.getByText(".claude/commands/analyze.md")).toBeVisible();
  await expect(page.getByText("Sẽ khởi tạo .claude/")).toBeVisible();
  const writeButton = page.getByRole("button", { name: "Ghi xuống đĩa" });
  await expect(writeButton).toBeEnabled();
  await writeButton.click();

  // S12 — result view.
  await expect(page.getByText(/file tạo mới/)).toBeVisible();
  await expect(page.getByText(/Sao lưu:/)).toBeVisible();

  // Confirm on real disk: agent file exists, contains the managed marker.
  const agentPath = join(daemon.projectRoot, ".claude", "agents", "code-reviewer.md");
  expect(existsSync(agentPath)).toBe(true);
  const agentContent = readFileSync(agentPath, "utf-8");
  expect(agentContent).toContain("name: code-reviewer");
  expect(agentContent).toContain("description: Independent reviewer agent");
  expect(agentContent).toMatch(/<!--\s*managed-by:\s*symbion\s+id=/);

  // Confirm on real disk: command file exists, contains $ARGUMENTS handling
  // and the managed marker (S8 coverage).
  const commandPath = join(daemon.projectRoot, ".claude", "commands", "analyze.md");
  expect(existsSync(commandPath)).toBe(true);
  const commandContent = readFileSync(commandPath, "utf-8");
  expect(commandContent).toContain("description: Research requirements, then synthesize");
  expect(commandContent).toContain("Analyze the following request:");
  expect(commandContent).toContain("$ARGUMENTS");
  expect(commandContent).toMatch(/<!--\s*managed-by:\s*symbion\s+id=/);

  await page.getByRole("button", { name: "Xong" }).click();
});
