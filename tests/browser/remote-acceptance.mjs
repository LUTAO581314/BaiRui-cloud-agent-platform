import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { fixtureCredentials, startBrowserFixture } from "./fixture-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifacts = path.join(root, "test-results", "remote-browser-acceptance");
fs.mkdirSync(artifacts, { recursive: true });

async function login(page, baseUrl, credentials, expectedPath) {
  const loginUrl = expectedPath === "/admin" ? `${baseUrl}/login?next=/admin` : `${baseUrl}/login`;
  await page.goto(loginUrl, { waitUntil: "networkidle" });
  await page.locator('input[name="email"]').fill(credentials.email);
  await page.locator('input[name="password"]').fill(credentials.password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === expectedPath),
    page.locator('#login-form button[type="submit"]').click()
  ]);
}

async function assertNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth }));
  assert.ok(metrics.documentWidth <= metrics.viewportWidth + 1, `horizontal overflow: ${metrics.documentWidth}px > ${metrics.viewportWidth}px`);
}

async function ordinaryDesktop(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await login(page, baseUrl, fixtureCredentials.user, "/app");
  await page.locator("#graph").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelectorAll("#graph circle").length >= 3);
  await page.locator(".bairui-platform-tools").waitFor({ state: "visible" });
  await page.locator(".bairui-chat-header").waitFor({ state: "visible" });
  assert.equal(await page.locator("#panel-l1-tab").count(), 1, "missing left panel control");
  assert.equal(await page.locator("#panel-l2-tab").count(), 1, "missing right panel control");
  const chatWidthBeforeCollapse = await page.locator("#chat-area").evaluate((element) => element.getBoundingClientRect().width);
  await page.locator("#panel-l1-tab").click();
  await page.waitForFunction(() => document.body.classList.contains("l1-collapsed"));
  await page.waitForTimeout(450);
  const chatWidthAfterCollapse = await page.locator("#chat-area").evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(chatWidthAfterCollapse > chatWidthBeforeCollapse + 200, "collapsing the left panel must expand the Hermes chat column");
  await page.locator("#panel-l1-tab").click();
  await page.waitForFunction(() => !document.body.classList.contains("l1-collapsed"));
  assert.equal(await page.locator('head link[data-bairui-overlay][href="/assets/bairui-bailongma.css"]').count(), 1, "BaiRui overlay link is not in the document head");
  assert.equal((await page.request.get(`${baseUrl}/assets/bairui-bailongma.css`)).status(), 200, "BaiRui overlay stylesheet request failed");
  assert.equal(await page.locator('.bairui-attach-button[data-action="attach-image"]').count(), 1);
  const chatGeometry = await page.locator("#chat-area").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { top: rect.top, bottom: rect.bottom, height: rect.height, viewport: innerHeight, position: style.position, styleHeight: style.height, rootZoom: document.documentElement.style.zoom };
  });
  assert.ok(chatGeometry.top < 100 && chatGeometry.bottom > chatGeometry.viewport - 40 && chatGeometry.height > chatGeometry.viewport * 0.75, `chat column is not viewport anchored: ${JSON.stringify(chatGeometry)}`);
  assert.equal(await page.locator('a[href="/admin"]').count(), 0, "ordinary users must not receive an admin link");
  assert.equal((await page.request.get(`${baseUrl}/api/admin/overview`)).status(), 403);
  assert.equal((await page.request.get(`${baseUrl}/admin`)).status(), 404);

  const views = ["conversations", "agents", "memory", "skills", "channels", "hotspots", "runs", "jobs", "usage", "settings"];
  const workspaceButton = page.locator('.bairui-platform-tools [data-action="workspace"]');
  const hitTest = await workspaceButton.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const tools = button.closest(".bairui-platform-tools");
    return { target: target?.tagName, targetId: target?.id, toolsParent: tools?.parentElement?.tagName, toolsZIndex: getComputedStyle(tools).zIndex };
  });
  process.stdout.write(`Desktop toolbar hit test: ${JSON.stringify(hitTest)}\n`);
  await workspaceButton.click();
  await page.locator(".bairui-workspace").waitFor({ state: "visible" });
  for (const view of views) assert.equal(await page.locator(`.bw-nav [data-view="${view}"]`).count(), 1, `missing user workspace view: ${view}`);
  await page.locator('.bw-nav [data-view="memory"]').click();
  await page.getByText("Hermes memory mapping", { exact: true }).waitFor();
  await page.getByText("Hermes MEMORY.md", { exact: true }).waitFor();
  await page.getByText("Hermes USER.md", { exact: true }).waitFor();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(artifacts, "user-desktop-memory.png"), fullPage: true });

  await page.locator('.bw-nav [data-view="skills"]').click();
  await page.getByText("Runtime Capabilities", { exact: true }).waitFor();
  await page.getByText("Web tools", { exact: true }).waitFor();
  await page.getByText("fixture-hermes-1.0.0", { exact: true }).waitFor();
  await page.getByText("approval events", { exact: true }).waitFor();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(artifacts, "user-desktop-runtime-capabilities.png"), fullPage: true });

  await page.locator('.bw-nav [data-view="jobs"]').click();
  await page.getByText("Daily research", { exact: true }).waitFor();
  await page.locator('[data-edit-job="job_remote"]').click();
  const jobDialog = page.locator("dialog.bw-dialog");
  await jobDialog.locator('input[name="name"]').fill("Daily verified research");
  await jobDialog.locator('textarea[name="prompt"]').fill("Summarize verified project updates");
  await jobDialog.locator('button[type="submit"]').click();
  await page.getByText("Daily verified research", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifacts, "user-desktop-jobs.png"), fullPage: true });

  await page.locator('.bw-nav [data-view="settings"]').click();
  await page.getByText("第三方授权", { exact: true }).waitFor();
  await page.locator("[data-auth-new]").click();
  const authorizationDialog = page.locator("dialog.bw-dialog");
  await authorizationDialog.locator('select[name="service"]').selectOption("firecrawl");
  await authorizationDialog.locator('input[name="label"]').fill("Remote Firecrawl");
  await authorizationDialog.locator('input[name="endpointUrl"]').fill("https://api.firecrawl.dev/v1");
  await authorizationDialog.locator('input[name="secret"]').fill("remote-browser-firecrawl-secret");
  await authorizationDialog.locator('button[type="submit"]').click();
  await page.getByText("Remote Firecrawl", { exact: true }).waitFor();
  const authorizationPayload = await (await page.request.get(`${baseUrl}/api/user/agents/agent_remote/authorizations`)).text();
  assert.doesNotMatch(authorizationPayload, /remote-browser-firecrawl-secret/);
  await page.screenshot({ path: path.join(artifacts, "user-desktop-settings.png"), fullPage: true });

  await page.locator(".bw-header [data-close]").click();
  await page.locator("#msg-input").fill("Reply from the Hermes remote fixture");
  const sendGeometry = await page.locator("#send-btn").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const area = document.querySelector("#chat-area");
    const areaRect = area.getBoundingClientRect();
    const rowRect = document.querySelector("#input-row").getBoundingClientRect();
    const style = getComputedStyle(area);
    return { top: rect.top, bottom: rect.bottom, viewport: innerHeight, rowTop: rowRect.top, rowBottom: rowRect.bottom, areaTop: areaRect.top, areaBottom: areaRect.bottom, areaHeight: areaRect.height, display: style.display, gridTemplateRows: style.gridTemplateRows, inlineHeight: area.style.height, rootZoom: document.documentElement.style.zoom };
  });
  process.stdout.write(`Desktop composer geometry: ${JSON.stringify(sendGeometry)}\n`);
  assert.ok(sendGeometry.top >= 0 && sendGeometry.bottom <= sendGeometry.viewport, `send button is outside viewport: ${JSON.stringify(sendGeometry)}`);
  await page.locator("#send-btn").click();
  await page.getByText("Remote acceptance reply", { exact: false }).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: path.join(artifacts, "user-desktop-chat.png"), fullPage: true });
  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join("; ")}`);
  await context.close();
}

async function ordinaryMobile(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await login(page, baseUrl, fixtureCredentials.user, "/app");
  await page.locator("#graph").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.body.classList.contains("l1-collapsed") && document.body.classList.contains("l2-collapsed"));
  await page.locator("#panel-l1-tab").click();
  await page.waitForFunction(() => !document.body.classList.contains("l1-collapsed") && document.body.classList.contains("l2-collapsed"));
  const mobilePanel = await page.locator("#panel-l1").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: innerWidth };
  });
  assert.ok(mobilePanel.left >= 0 && mobilePanel.right <= mobilePanel.viewport, `mobile left panel is not a bounded drawer: ${JSON.stringify(mobilePanel)}`);
  await page.locator(".bairui-panel-scrim").click({ position: { x: 380, y: 500 } });
  await page.waitForFunction(() => document.body.classList.contains("l1-collapsed") && document.body.classList.contains("l2-collapsed"));
  await page.locator('.bairui-platform-tools [data-action="workspace"]').click();
  await page.locator('.bw-nav [data-view="memory"]').click();
  await page.getByText("Hermes memory mapping", { exact: true }).waitFor();
  const mobileChrome = await page.evaluate(() => {
    const toolbar = document.querySelector(".bairui-platform-tools").getBoundingClientRect();
    const header = document.querySelector(".bw-header").getBoundingClientRect();
    return { toolbarBottom: toolbar.bottom, headerTop: header.top, headerBottom: header.bottom };
  });
  assert.ok(mobileChrome.headerTop >= mobileChrome.toolbarBottom - 1, `mobile toolbar overlaps workspace header: ${JSON.stringify(mobileChrome)}`);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(artifacts, "user-mobile-memory.png"), fullPage: true });
  await page.locator('.bw-nav [data-view="skills"]').click();
  await page.getByText("Runtime Capabilities", { exact: true }).waitFor();
  await page.getByText("Web tools", { exact: true }).waitFor();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(artifacts, "user-mobile-runtime-capabilities.png"), fullPage: true });
  await context.close();
}

async function platformAdmin(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await login(page, baseUrl, fixtureCredentials.admin, "/admin");
  await page.locator('.control-shell[data-admin-role="platform_admin"]').waitFor();
  const expectedPanels = ["overview", "users", "agents", "operations", "providers", "integrations", "channels", "config", "versions", "alerts", "audit", "release", "backups", "retention", "sensitive"];
  for (const panel of expectedPanels) assert.equal(await page.locator(`[data-view-panel="${panel}"]`).count(), 1, `missing admin panel: ${panel}`);
  await page.locator('[data-admin-view="agents"]').click();
  await page.locator("#agent-rows").getByText("Hermes Memory Agent", { exact: true }).waitFor();
  await page.locator('[data-admin-view="integrations"]').click();
  await page.locator("#integration-authorization-rows").getByText("Remote Firecrawl", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifacts, "admin-integration-authorizations.png"), fullPage: true });
  await page.locator('[data-admin-view="agents"]').click();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(artifacts, "admin-agent-fleet.png"), fullPage: true });
  await context.close();
}

const fixture = await startBrowserFixture();
const browser = await chromium.launch({ headless: true });
try {
  await ordinaryDesktop(browser, fixture.baseUrl);
  await ordinaryMobile(browser, fixture.baseUrl);
  await platformAdmin(browser, fixture.baseUrl);
  process.stdout.write(`Remote browser acceptance passed. Artifacts: ${artifacts}\n`);
} finally {
  await browser.close();
  await fixture.close();
}
