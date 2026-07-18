import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { fixtureCredentials, startBrowserFixture } from "./fixture-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifacts = path.join(root, "test-results", "remote-browser-acceptance");
const workspaceHost = "[data-bairui-extension-host]";
const workspaceNav = "[data-bairui-workspace-nav]";
const workspaceViews = ["conversations", "agents", "memory", "skills", "channels", "hotspots", "runs", "jobs", "usage", "hermes", "settings"];
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

async function waitForVisibleGraph(page, browserErrors = []) {
  const graph = page.locator("#graph");
  await graph.waitFor({ state: "attached" });
  try {
    await graph.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    const diagnostics = await graph.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { bodyClass: document.body.className, display: style.display, visibility: style.visibility, opacity: style.opacity, width: rect.width, height: rect.height, documentState: document.readyState };
    });
    throw new Error(`BaiLongma graph did not become visible: ${JSON.stringify({ ...diagnostics, browserErrors })}`);
  }
}

async function waitForWorkspaceText(page, value) {
  await Promise.race([
    page.getByText(value, { exact: true }).waitFor(),
    page.locator(".bw-error").waitFor().then(async () => {
      throw new Error(`workspace render failed: ${await page.locator(".bw-error").innerText()}`);
    })
  ]);
}

async function waitForRuntimeOperation(operations, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const operation = operations.find(predicate);
    if (operation) return operation;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Expected Runtime operation was not observed");
}

async function ordinaryDesktop(browser, fixture) {
  const { baseUrl, runtimeOperations } = fixture;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.stack || error.message));
  await login(page, baseUrl, fixtureCredentials.user, "/app");
  await waitForVisibleGraph(page, browserErrors);
  await page.waitForFunction(() => document.querySelectorAll("#graph circle").length >= 3);
  await page.locator(".bairui-platform-tools").waitFor({ state: "visible" });
  await page.locator(".bairui-chat-header").waitFor({ state: "visible" });
  const hostAdapter = await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "BairuiHostAdapter");
    return {
      configurable: descriptor?.configurable,
      writable: descriptor?.writable,
      methods: Object.keys(descriptor?.value || {}).sort()
    };
  });
  assert.equal(hostAdapter.configurable, false);
  assert.equal(hostAdapter.writable, false);
  assert.deepEqual(hostAdapter.methods, ["agentProfile", "conversations", "memories", "openEvents", "sendMessage"]);
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
  assert.equal(await page.locator(".brain-app, .brain-header, .brain-view-tabs").count(), 0, "legacy handcrafted user shell must not exist");
  assert.equal(await page.locator("#settings-overlay").count(), 0, "the local BaiLongma settings page must not create a second settings system");
  assert.equal(await page.locator(workspaceHost).count(), 1, "the user page must expose exactly one extension workspace host");
  assert.equal((await page.request.get(`${baseUrl}/api/admin/overview`)).status(), 403);
  assert.equal((await page.request.get(`${baseUrl}/admin`)).status(), 404);

  await page.evaluate(() => {
    window.__bairuiInitializationDialog = window.bairuiPlatform.initializeAgent({ id: "agent_remote", name: "Hermes Memory Agent" });
  });
  const initializationDialog = page.locator(".bairui-onboarding-form");
  await initializationDialog.getByText("初始化 Hermes", { exact: true }).waitFor();
  assert.equal(await initializationDialog.locator('input[name="modelMode"][value="agent"]').count(), 1);
  assert.equal(await initializationDialog.locator('input[name="modelMode"][value="platform"]').count(), 1);
  for (const field of ["hermesProvider", "hermesBaseUrl", "hermesModel", "hermesAuthType", "hermesApiKey"]) assert.equal(await initializationDialog.locator(`[name="${field}"]`).count(), 1, `missing Hermes initialization field: ${field}`);
  const modalLayers = await page.evaluate(() => ({ overlay: Number(getComputedStyle(document.querySelector(".bairui-onboarding")).zIndex), toolbar: Number(getComputedStyle(document.querySelector(".bairui-platform-tools")).zIndex) }));
  assert.ok(modalLayers.overlay > modalLayers.toolbar, `Hermes initialization must cover the Agent toolbar: ${JSON.stringify(modalLayers)}`);
  await page.screenshot({ path: path.join(artifacts, "user-desktop-hermes-initialization.png"), fullPage: true });
  await initializationDialog.locator("[data-later]").click();
  await initializationDialog.waitFor({ state: "detached" });

  const workspaceButton = page.locator('.bairui-platform-tools [data-action="workspace"]');
  const hitTest = await workspaceButton.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const tools = button.closest(".bairui-platform-tools");
    return { target: target?.tagName, targetId: target?.id, toolsParent: tools?.parentElement?.tagName, toolsZIndex: getComputedStyle(tools).zIndex };
  });
  process.stdout.write(`Desktop toolbar hit test: ${JSON.stringify(hitTest)}\n`);
  await workspaceButton.click();
  await page.locator(workspaceHost).waitFor({ state: "visible" });
  for (const view of workspaceViews) assert.equal(await page.locator(`${workspaceNav} [data-view="${view}"]`).count(), 1, `missing user workspace view: ${view}`);
  await page.locator(`${workspaceNav} [data-view="memory"]`).click();
  await waitForWorkspaceText(page, "Hermes memory mapping");
  await page.getByText("Hermes MEMORY.md", { exact: true }).waitFor();
  await page.getByText("Hermes USER.md", { exact: true }).waitFor();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(artifacts, "user-desktop-memory.png"), fullPage: true });

  await page.locator(`${workspaceNav} [data-view="skills"]`).click();
  await waitForWorkspaceText(page, "Runtime Capabilities");
  await page.getByText("Web tools", { exact: true }).waitFor();
  await page.getByText("fixture-hermes-1.0.0", { exact: true }).waitFor();
  await page.getByText("approval events", { exact: true }).waitFor();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(artifacts, "user-desktop-runtime-capabilities.png"), fullPage: true });

  await page.locator(`${workspaceNav} [data-view="jobs"]`).click();
  await page.getByText("Daily research", { exact: true }).waitFor();
  await page.locator('[data-edit-job="job_remote"]').click();
  const jobDialog = page.locator("dialog.bairui-extension-dialog");
  await jobDialog.locator('input[name="name"]').fill("Daily verified research");
  await jobDialog.locator('textarea[name="prompt"]').fill("Summarize verified project updates");
  await jobDialog.locator('button[type="submit"]').click();
  await page.getByText("Daily verified research", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifacts, "user-desktop-jobs.png"), fullPage: true });

  await page.locator(`${workspaceNav} [data-view="settings"]`).click();
  await waitForWorkspaceText(page, "个人连接");
  await page.locator("[data-auth-new]").click();
  const authorizationDialog = page.locator("dialog.bairui-extension-dialog");
  await authorizationDialog.locator('select[name="service"]').selectOption("firecrawl");
  await authorizationDialog.locator('input[name="label"]').fill("Remote Firecrawl");
  await authorizationDialog.locator('input[name="endpointUrl"]').fill("https://api.firecrawl.dev/v1");
  await authorizationDialog.locator('input[name="secret"]').fill("remote-browser-firecrawl-secret");
  await authorizationDialog.locator('button[type="submit"]').click();
  await page.getByText("Remote Firecrawl", { exact: true }).waitFor();
  const authorizationPayload = await (await page.request.get(`${baseUrl}/api/user/agents/agent_remote/authorizations`)).text();
  assert.doesNotMatch(authorizationPayload, /remote-browser-firecrawl-secret/);
  await page.screenshot({ path: path.join(artifacts, "user-desktop-settings.png"), fullPage: true });

  await page.locator("[data-bairui-workspace-close]").click();
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
  await page.waitForFunction(() => !document.body.classList.contains("bairui-streaming"));
  await page.locator("#msg-input").fill("Approval fixture request");
  await page.locator("#send-btn").click();
  const approval = page.locator("dialog.bairui-approval-dialog");
  await approval.waitFor({ state: "visible" });
  await approval.getByText("Hermes 请求操作授权", { exact: true }).waitFor();
  await approval.getByText("echo approval-fixture", { exact: true }).waitFor();
  assert.equal(await approval.locator('[data-choice="always"]').count(), 0, "permanent approval must be hidden when Hermes forbids it");
  await page.screenshot({ path: path.join(artifacts, "user-desktop-approval.png"), fullPage: true });
  await approval.locator('[data-choice="once"]').click();
  await page.getByText("Approved fixture reply", { exact: false }).waitFor({ timeout: 15_000 });
  const approveOperation = await waitForRuntimeOperation(runtimeOperations, (item) => item.operation === "runs.approve" && item.input.run_id === "run_approval_remote");
  assert.equal(approveOperation.input.choice, "once");

  await page.waitForFunction(() => !document.body.classList.contains("bairui-streaming"));
  await page.locator("#msg-input").fill("Stop fixture request");
  await page.locator("#send-btn").click();
  await page.waitForFunction(() => document.body.classList.contains("bairui-streaming"));
  await page.locator("#send-btn").click();
  const stopOperation = await waitForRuntimeOperation(runtimeOperations, (item) => item.operation === "runs.stop" && item.input.run_id === "run_stop_remote");
  assert.equal(stopOperation.input.run_id, "run_stop_remote");
  await page.waitForFunction(() => !document.body.classList.contains("bairui-streaming"));
  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join("; ")}`);
  await context.close();
}

async function ordinaryShellViewport(browser, fixture, name, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.stack || error.message));
  await login(page, fixture.baseUrl, fixtureCredentials.user, "/app");
  await waitForVisibleGraph(page, browserErrors);
  await page.locator(".bairui-platform-tools").waitFor({ state: "visible" });
  if (browserErrors.length) throw new Error(`${name} initial browser errors: ${browserErrors.join("; ")}`);
  assert.equal(await page.locator(workspaceHost).count(), 1, `${name}: expected one workspace host`);
  assert.equal(await page.locator("#settings-overlay").count(), 0, `${name}: local settings overlay must be absent`);
  assert.equal(await page.locator(".brain-app, .brain-header, .brain-view-tabs").count(), 0, `${name}: legacy user shell must be absent`);

  const left = page.locator("#panel-l1-tab");
  const right = page.locator("#panel-l2-tab");
  await left.click();
  await page.waitForFunction(() => document.body.classList.contains("l1-collapsed") && !document.body.classList.contains("l2-collapsed"));
  assert.equal(await left.getAttribute("aria-expanded"), "false", `${name}: left panel state is not exposed`);
  assert.equal(await right.getAttribute("aria-expanded"), "true", `${name}: right panel must remain independently open`);
  assert.equal(await page.locator("#panel-l1").getAttribute("aria-hidden"), "true");
  assert.equal(await page.locator("#panel-l2").getAttribute("aria-hidden"), "false");
  await left.click();
  await right.click();
  await page.waitForFunction(() => !document.body.classList.contains("l1-collapsed") && document.body.classList.contains("l2-collapsed"));
  assert.equal(await left.getAttribute("aria-expanded"), "true", `${name}: left panel must remain independently open`);
  assert.equal(await right.getAttribute("aria-expanded"), "false", `${name}: right panel state is not exposed`);
  await right.click();

  await page.locator("#settings-btn").click();
  await page.locator(workspaceHost).waitFor({ state: "visible" });
  for (const view of workspaceViews) assert.equal(await page.locator(`${workspaceNav} [data-view="${view}"]`).count(), 1, `${name}: missing ${view} extension`);
  const geometry = await page.locator(`${workspaceHost} .bairui-workspace-modal`).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  assert.ok(geometry.left >= 0 && geometry.top >= 0 && geometry.right <= geometry.viewportWidth && geometry.bottom <= geometry.viewportHeight, `${name}: workspace is outside viewport: ${JSON.stringify(geometry)}`);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(artifacts, `user-${name}-workspace.png`), fullPage: true });
  await page.locator("[data-bairui-workspace-close]").click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "settings-btn", `${name}: closing the workspace must restore focus`);
  assert.deepEqual(browserErrors, [], `${name} browser errors: ${browserErrors.join("; ")}`);
  await context.close();
}

async function ordinaryMobile(browser, fixture) {
  const { baseUrl, runtimeOperations } = fixture;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.stack || error.message));
  await login(page, baseUrl, fixtureCredentials.user, "/app");
  await waitForVisibleGraph(page, browserErrors);
  await page.evaluate(() => { window.__bairuiMobileInitializationDialog = window.bairuiPlatform.initializeAgent({ id: "agent_remote", name: "Hermes Memory Agent" }); });
  const initializationDialog = page.locator(".bairui-onboarding-form");
  await initializationDialog.getByText("初始化 Hermes", { exact: true }).waitFor();
  const initializationGeometry = await initializationDialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  assert.ok(initializationGeometry.left >= 0 && initializationGeometry.top >= 0 && initializationGeometry.right <= initializationGeometry.viewportWidth && initializationGeometry.bottom <= initializationGeometry.viewportHeight, `mobile Hermes initialization must remain inside the viewport: ${JSON.stringify(initializationGeometry)}`);
  await page.screenshot({ path: path.join(artifacts, "user-mobile-hermes-initialization.png"), fullPage: true });
  await initializationDialog.locator("[data-later]").click();
  await initializationDialog.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.body.classList.contains("l1-collapsed") && document.body.classList.contains("l2-collapsed"));
  await page.locator("#panel-l1-tab").click();
  await page.waitForFunction(() => {
    const panel = document.querySelector("#panel-l1");
    if (!panel || document.body.classList.contains("l1-collapsed") || !document.body.classList.contains("l2-collapsed")) return false;
    const rect = panel.getBoundingClientRect();
    return rect.left >= -1 && rect.right <= innerWidth + 1;
  });
  const mobilePanel = await page.locator("#panel-l1").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: innerWidth };
  });
  assert.ok(mobilePanel.left >= 0 && mobilePanel.right <= mobilePanel.viewport, `mobile left panel is not a bounded drawer: ${JSON.stringify(mobilePanel)}`);
  await page.locator(".bairui-panel-scrim").click({ position: { x: 380, y: 500 } });
  await page.waitForFunction(() => document.body.classList.contains("l1-collapsed") && document.body.classList.contains("l2-collapsed"));
  await page.locator('.bairui-platform-tools [data-action="workspace"]').click();
  await page.locator(`${workspaceNav} [data-view="memory"]`).click();
  await waitForWorkspaceText(page, "Hermes memory mapping");
  const mobileChrome = await page.evaluate(() => {
    const toolbar = document.querySelector(".bairui-platform-tools").getBoundingClientRect();
    const host = document.querySelector("[data-bairui-extension-host]");
    const header = host.querySelector(".settings-header").getBoundingClientRect();
    return { toolbarBottom: toolbar.bottom, headerTop: header.top, headerBottom: header.bottom, viewportHeight: innerHeight, hostZIndex: Number(getComputedStyle(host).zIndex), toolbarZIndex: Number(getComputedStyle(document.querySelector(".bairui-platform-tools")).zIndex) };
  });
  assert.ok(mobileChrome.hostZIndex > mobileChrome.toolbarZIndex, `mobile workspace must cover the toolbar: ${JSON.stringify(mobileChrome)}`);
  assert.ok(mobileChrome.headerTop >= 0 && mobileChrome.headerBottom <= mobileChrome.viewportHeight, `mobile workspace header is outside the viewport: ${JSON.stringify(mobileChrome)}`);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(artifacts, "user-mobile-memory.png"), fullPage: true });
  await page.locator(`${workspaceNav} [data-view="skills"]`).click();
  await waitForWorkspaceText(page, "Runtime Capabilities");
  await page.getByText("Web tools", { exact: true }).waitFor();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(artifacts, "user-mobile-runtime-capabilities.png"), fullPage: true });
  await page.locator("[data-bairui-workspace-close]").click();
  await page.locator("#msg-input").fill("Approval fixture request");
  await page.locator("#send-btn").click();
  const approval = page.locator("dialog.bairui-approval-dialog");
  await approval.waitFor({ state: "visible" });
  const approvalGeometry = await approval.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  assert.ok(approvalGeometry.left >= 0 && approvalGeometry.top >= 0 && approvalGeometry.right <= approvalGeometry.viewportWidth && approvalGeometry.bottom <= approvalGeometry.viewportHeight, "mobile approval dialog must remain inside the viewport");
  await page.screenshot({ path: path.join(artifacts, "user-mobile-approval.png"), fullPage: true });
  await approval.locator('[data-choice="deny"]').click();
  await waitForRuntimeOperation(runtimeOperations, (item) => item.operation === "runs.approve" && item.input.run_id === "run_approval_remote" && item.input.choice === "deny");
  await page.waitForFunction(() => !document.body.classList.contains("bairui-streaming"));
  assert.deepEqual(browserErrors, [], `mobile browser errors: ${browserErrors.join("; ")}`);
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
  await ordinaryShellViewport(browser, fixture, "wide", { width: 1920, height: 1080 });
  await ordinaryDesktop(browser, fixture);
  await ordinaryShellViewport(browser, fixture, "tablet", { width: 1024, height: 768 });
  await ordinaryMobile(browser, fixture);
  await platformAdmin(browser, fixture.baseUrl);
  process.stdout.write(`Remote browser acceptance passed. Artifacts: ${artifacts}\n`);
} finally {
  await browser.close();
  await fixture.close();
}
