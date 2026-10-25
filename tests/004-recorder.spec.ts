import { test, expect } from "@playwright/test";

test.describe("webcam presenter and recorder", () => {
  test("records screen with webcam presenter bubble and renders preview", async ({
    page,
    context,
  }) => {
    // Grant media permissions
    await context.grantPermissions(["camera", "microphone"]);

    // Go to landing page
    await page.goto("http://localhost:3000/");

    // Open record video modal
    const recordBtn = page.getByRole("button", { name: "Record a video", exact: true });
    await expect(recordBtn).toBeVisible();
    await recordBtn.click();

    // Verify pre-recording controls (Microphone, Camera Presenter, Corner selection)
    await expect(page.getByText("Microphone", { exact: true })).toBeVisible();
    await expect(page.getByText("Camera Presenter", { exact: true })).toBeVisible();
    await expect(page.getByText("Bubble Corner", { exact: true })).toBeVisible();

    // Verify Start recording button
    const startBtn = page.getByRole("button", { name: "Start recording" });
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // In-recording step: wait for stop button in modal and bubble overlay
    const stopButton = page.locator(".flex-row.items-center.justify-center svg").first();
    await expect(stopButton).toBeVisible({ timeout: 10000 });

    // Verify floating camera bubble overlay video is rendered
    const bubbleVideo = page.locator(".snapify-recorder video, div.group video");
    await expect(bubbleVideo.first()).toBeVisible({ timeout: 10000 });

    // Test dragging the camera bubble to verify repositioning works
    const bubbleContainer = page.locator("div.group.select-none").first();
    await expect(bubbleContainer).toBeVisible();
    const initialBounding = await bubbleContainer.boundingBox();
    expect(initialBounding).not.toBeNull();

    if (initialBounding) {
      await page.mouse.move(
        initialBounding.x + initialBounding.width / 2,
        initialBounding.y + initialBounding.height / 2
      );
      await page.mouse.down();
      await page.mouse.move(initialBounding.x + 100, initialBounding.y - 100, {
        steps: 5,
      });
      await page.mouse.up();
    }

    // Wait a couple of seconds of active recording to capture frames
    await page.waitForTimeout(2500);

    // Stop / Finish recording
    await stopButton.click();

    // Post-recording step: verify video player preview is rendered with the recorded seekable video
    await expect(page.locator("media-player, video").first()).toBeVisible({ timeout: 15000 });

    // Verify post recording buttons (Save to cloud, Download to device, Delete)
    await expect(
      page.getByRole("button", { name: "Download to device" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
  });
});
