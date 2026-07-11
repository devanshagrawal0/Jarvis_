import { expect, test } from "@playwright/test";

test("Co-Op Symbiote workspace creates a session, shows shared files, Patch Court, bridge, and memory panels", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Co-Op" }).click();
  const sheet = page.getByRole("complementary", { name: "coop panel" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Jarvis Co-Op Symbiote Mesh");
  await expect(sheet).toContainText("Shared File Tree");
  await expect(sheet).toContainText("Patch Court");
  await expect(sheet).toContainText("Jarvis-to-Jarvis Bridge");
  await expect(sheet).toContainText("Skill Transfer Dock");
  await expect(sheet).toContainText("Replay Theater");

  await sheet.getByRole("button", { name: "Create Symbiote Session" }).click();
  await expect(sheet).toContainText(/\d{3}-\d{3}/);
  await expect(page.getByRole("complementary", { name: "Co-Op Runtime Widget" })).toBeVisible();

  await sheet.getByPlaceholder("Message trusted friend...").fill("Review the source manifest.");
  await sheet.getByRole("button", { name: "Send co-op chat" }).click();
  await expect(sheet).toContainText("Review the source manifest.");

  await sheet.getByRole("button", { name: "Start Jarvis Debate" }).click();
  await expect(sheet).toContainText("decision_response");

  await sheet.getByPlaceholder("Add task...").fill("Run co-op checks");
  await sheet.getByRole("button", { name: "Create co-op task" }).click();
  await expect(sheet).toContainText("Run co-op checks");

  await sheet.getByRole("button", { name: "Memory Packet", exact: true }).click();
  await expect(sheet).toContainText("project-only");

  await sheet.getByRole("button", { name: "Offer Safe Skill" }).click();
  await expect(sheet).toContainText("co-op-safe-patch-review");

  await sheet.getByRole("button", { name: "Capture Replay" }).click();
  await expect(sheet).toContainText("timeline");
});
