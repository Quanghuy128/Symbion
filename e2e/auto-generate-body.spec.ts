import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { bootDaemon, type DaemonHandle } from "./daemon-fixture";

/**
 * Auto-generate "Nội dung" (body) via real AI e2e (testplan §6, TC-E1..TC-E9).
 * Boots the real daemon AND a fake local HTTP server standing in for Ollama
 * (Tier A per testplan §0 — runs everywhere, no real Ollama install required).
 * Tier B cases (real Ollama, real model tags actually pulled) are NOT covered
 * here — they must be run manually/locally per the testplan's own instruction
 * that Tier B degrades to "skipped", never "fails because Ollama isn't installed".
 */

let daemon: DaemonHandle;
let fakeOllama: Server | undefined;

async function startFakeOllama(respond: (req: any, res: any) => void): Promise<string> {
  return new Promise((resolve) => {
    const s = createServer(respond);
    fakeOllama = s;
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

test.afterEach(async () => {
  await daemon?.stop();
  if (fakeOllama) {
    await new Promise<void>((resolve) => fakeOllama!.close(() => resolve()));
    fakeOllama = undefined;
  }
});

async function createProjectAndOpenAgentForm(page: import("@playwright/test").Page) {
  await page.goto(daemon.url);
  await page.getByRole("button", { name: "+ Tạo dự án" }).first().click();
  await page.getByPlaceholder("My API Service").fill("e2e-genbody");
  await page.getByPlaceholder("/home/me/code/my-service").fill(daemon.projectRoot);
  await expect(page.getByText("✓ Thư mục tồn tại")).toBeVisible();
  await page.getByRole("button", { name: "Tạo dự án", exact: true }).click();
  await expect(page.getByRole("button", { name: "+ Thêm agent" }).first()).toBeVisible();
  await page.getByRole("button", { name: "+ Thêm agent" }).first().click();
  await expect(page.getByText("Agent builder")).toBeVisible();
}

/** Clicks the generate button; the FIRST click in a fresh browser profile opens the
 * one-time disclosure dialog instead of immediately proceeding (EC-7). Acknowledging
 * the disclosure ("Đã hiểu") itself proceeds straight to confirm-replace/the RPC call
 * (GenerateBodyButton.handleDisclosureAck calls proceedToGenerate() synchronously) —
 * so this helper must NOT click the generate button a second time after acking, that
 * would race against (and get blocked by) whatever dialog proceedToGenerate() opens. */
async function clickGenerate(page: import("@playwright/test").Page) {
  const generateButton = page.getByRole("button", { name: "Tạo nội dung bằng AI" });
  await generateButton.click();
  const ackButton = page.getByRole("button", { name: "Đã hiểu" });
  if (await ackButton.isVisible().catch(() => false)) {
    await ackButton.click();
  }
}

test("TC-E1/TC-E2 — happy path: fills Nội dung with AI-generated text via a real outbound RPC + HTTP call", async ({
  page,
}) => {
  let requestBody: any;
  const baseUrl = await startFakeOllama((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c));
    req.on("end", () => {
      requestBody = JSON.parse(raw);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ response: "## System prompt\nYou are a careful code reviewer." }));
    });
  });
  daemon = await bootDaemon({ extraEnv: { SYMBION_OLLAMA_BASE_URL: baseUrl } });

  await createProjectAndOpenAgentForm(page);
  await page.getByPlaceholder("code-reviewer").fill("code-reviewer");
  await page.getByPlaceholder("Independent reviewer…").fill("Reviews PRs for bugs");

  const rpcRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/rpc")) {
      const body = req.postDataJSON?.() as { method?: string } | undefined;
      if (body?.method === "generateBody") rpcRequests.push(body.method);
    }
  });

  await clickGenerate(page);

  await expect(page.locator("textarea")).toHaveValue(/careful code reviewer/, { timeout: 10_000 });
  expect(rpcRequests).toContain("generateBody");
  expect(requestBody?.model).toBeTruthy();
});

test("TC-E3 (AC-1 regression) — sparkle icon is gone from beside description, present beside Nội dung", async ({
  page,
}) => {
  daemon = await bootDaemon();
  await createProjectAndOpenAgentForm(page);

  // No generate-style button rendered directly next to the description input.
  await expect(page.getByRole("button", { name: "Tạo mô tả tự động" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tạo nội dung bằng AI" })).toBeVisible();
});

test("TC-E4 (AC-5/EC-2) — confirm-before-replace: Hủy preserves original text, Thay thế replaces after confirm", async ({
  page,
}) => {
  const baseUrl = await startFakeOllama((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ response: "Generated replacement body." }));
  });
  daemon = await bootDaemon({ extraEnv: { SYMBION_OLLAMA_BASE_URL: baseUrl } });

  await createProjectAndOpenAgentForm(page);
  await page.getByPlaceholder("code-reviewer").fill("code-reviewer");
  await page.locator("textarea").fill("My hand-written existing body.");

  await clickGenerate(page);
  await expect(page.getByText("Thay thế nội dung?")).toBeVisible();

  const confirmDialog = page
    .locator("h2", { hasText: "Thay thế nội dung?" })
    .locator("xpath=(ancestor::div[contains(@class, 'fixed')])[last()]");
  await confirmDialog.getByRole("button", { name: "Hủy" }).click();

  await expect(page.getByText("Thay thế nội dung?")).not.toBeVisible();
  await expect(page.locator("textarea")).toHaveValue("My hand-written existing body.");

  await page.getByRole("button", { name: "Tạo nội dung bằng AI" }).click();
  await page.getByRole("button", { name: "Thay thế" }).click();
  await expect(page.locator("textarea")).toHaveValue("Generated replacement body.", { timeout: 10_000 });
});

test("TC-E5 (AC-6/EC-4) — Ollama unreachable -> inline error, Nội dung unchanged, Save still works", async ({
  page,
}) => {
  // Point at a port nothing is listening on to simulate "Ollama not running".
  daemon = await bootDaemon({ extraEnv: { SYMBION_OLLAMA_BASE_URL: "http://127.0.0.1:1" } });

  await createProjectAndOpenAgentForm(page);
  await page.getByPlaceholder("code-reviewer").fill("code-reviewer");
  await page.getByPlaceholder("Independent reviewer…").fill("Reviews PRs for bugs");
  await page.locator("textarea").fill("");

  await clickGenerate(page);

  await expect(page.getByText(/Không thể kết nối tới Ollama/)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("textarea")).toHaveValue("");

  await page.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByText("Agent builder")).not.toBeVisible();
});

test("TC-E6 (AC-4) — rapid double-click fires exactly one generateBody RPC request", async ({ page }) => {
  const baseUrl = await startFakeOllama((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ response: "Slow generated body." }));
    }, 300);
  });
  daemon = await bootDaemon({ extraEnv: { SYMBION_OLLAMA_BASE_URL: baseUrl } });

  await createProjectAndOpenAgentForm(page);
  await page.getByPlaceholder("code-reviewer").fill("code-reviewer");

  // Acknowledge the one-time disclosure first (out of the timed double-click window),
  // so the double-click below exercises the busyRef/in-flight guard specifically,
  // not the disclosure gate.
  await clickGenerate(page);
  await expect(page.locator("textarea")).toHaveValue(/Slow generated body/, { timeout: 10_000 });
  await page.locator("textarea").fill(""); // reset for a clean re-test of the double-click below

  let generateBodyCount = 0;
  page.on("request", (req) => {
    if (req.url().includes("/rpc")) {
      const body = req.postDataJSON?.() as { method?: string } | undefined;
      if (body?.method === "generateBody") generateBodyCount += 1;
    }
  });

  // Wait out the post-resolve cooldown (4s) from the warm-up call above before
  // exercising the double-click, so the cooldown guard doesn't mask the assertion.
  await page.waitForTimeout(4200);

  const generateButton = page.getByRole("button", { name: "Tạo nội dung bằng AI" });
  await Promise.all([generateButton.click(), generateButton.click()]);
  await expect(page.locator("textarea")).toHaveValue(/Slow generated body/, { timeout: 10_000 });

  expect(generateBodyCount).toBe(1);
});

test("TC-E7 (EC-8) — daemon disconnected -> generate button disabled", async ({ page }) => {
  daemon = await bootDaemon();
  await createProjectAndOpenAgentForm(page);
  await page.getByPlaceholder("code-reviewer").fill("code-reviewer");

  await page.route("**/rpc", async (route) => {
    const body = route.request().postDataJSON() as { method?: string };
    if (body?.method === "ping") {
      await route.abort();
      return;
    }
    await route.continue();
  });

  await expect(page.getByText("daemon mất kết nối")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Tạo nội dung bằng AI" })).toBeDisabled();
});

test("TC-E8 (EC-7) — first click in a fresh profile shows the one-time disclosure dialog with Ollama-appropriate copy", async ({
  page,
}) => {
  daemon = await bootDaemon();
  await createProjectAndOpenAgentForm(page);

  // Persistent micro-copy is visible even before any click (compliance-bearing disclosure).
  await expect(page.getByText(/gửi tên\/mô tả\/nội dung hiện tại tới mô hình chạy trên máy bạn, không gửi ra ngoài/)).toBeVisible();

  await page.getByRole("button", { name: "Tạo nội dung bằng AI" }).click();

  await expect(page.getByText("Sử dụng AI để tạo nội dung")).toBeVisible();
  await expect(page.getByText(/không được gửi ra ngoài máy/)).toBeVisible();

  await page.getByRole("button", { name: "Đã hiểu" }).click();
  await expect(page.getByText("Sử dụng AI để tạo nội dung")).not.toBeVisible();
});

test("TC-E10 (AC-3) — ModelPicker offers 3 real selectable models", async ({ page }) => {
  daemon = await bootDaemon();
  await createProjectAndOpenAgentForm(page);

  const picker = page.getByLabel("Chọn mô hình AI");
  await expect(picker).toBeVisible();
  const optionCount = await picker.locator("option").count();
  expect(optionCount).toBe(3);
});
