export type BubbleCorner =
  | "bottom-left"
  | "bottom-right"
  | "top-left"
  | "top-right";

export type BubbleSize = "small" | "medium" | "large";

export interface CompositorOptions {
  screenStream: MediaStream;
  cameraStream?: MediaStream | null;
  audioStream?: MediaStream | null;
  corner?: BubbleCorner;
  normalizedPosition?: { x: number; y: number }; // 0 to 1
  size?: BubbleSize;
  mirrored?: boolean;
  cameraMuted?: boolean;
  frameRate?: number;
}

export class CanvasCompositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private screenVideo: HTMLVideoElement;
  private cameraVideo: HTMLVideoElement | null = null;
  private animationFrameId: number | null = null;
  private outputStream: MediaStream | null = null;

  private isMirrored: boolean;
  private isCameraMuted: boolean;
  private corner: BubbleCorner;
  private customPosition: { x: number; y: number } | null = null;
  private size: BubbleSize;
  private frameRate: number;
  private isRunning = false;

  constructor(options: CompositorOptions) {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("Unable to create canvas 2D context");
    }
    this.ctx = ctx;

    this.corner = options.corner ?? "bottom-left";
    this.customPosition = options.normalizedPosition ?? null;
    this.size = options.size ?? "medium";
    this.isMirrored = options.mirrored ?? true;
    this.isCameraMuted = options.cameraMuted ?? false;
    this.frameRate = options.frameRate ?? 30;

    // Create and attach screen video
    this.screenVideo = document.createElement("video");
    this.screenVideo.muted = true;
    this.screenVideo.playsInline = true;
    this.screenVideo.autoplay = true;
    this.screenVideo.srcObject = options.screenStream;

    // Create and attach camera video if stream provided
    if (options.cameraStream) {
      this.attachCameraStream(options.cameraStream);
    }
  }

  public attachCameraStream(cameraStream: MediaStream) {
    if (!this.cameraVideo) {
      this.cameraVideo = document.createElement("video");
      this.cameraVideo.muted = true;
      this.cameraVideo.playsInline = true;
      this.cameraVideo.autoplay = true;
    }
    this.cameraVideo.srcObject = cameraStream;
    this.cameraVideo.play().catch((err) => {
      console.warn("Autoplay camera video failed:", err);
    });
  }

  public detachCameraStream() {
    if (this.cameraVideo) {
      this.cameraVideo.pause();
      this.cameraVideo.srcObject = null;
      this.cameraVideo = null;
    }
  }

  public async start(): Promise<MediaStream> {
    // Wait for screen video dimensions
    await new Promise<void>((resolve) => {
      if (
        this.screenVideo.readyState >= 1 &&
        this.screenVideo.videoWidth > 0
      ) {
        resolve();
      } else {
        this.screenVideo.onloadedmetadata = () => {
          resolve();
        };
      }
      this.screenVideo.play().catch(() => {
        // Ignored
      });
    });

    const width = this.screenVideo.videoWidth || 1920;
    const height = this.screenVideo.videoHeight || 1080;
    this.canvas.width = width;
    this.canvas.height = height;

    if (this.cameraVideo) {
      await this.cameraVideo.play().catch(() => {
        // Ignored
      });
    }

    this.isRunning = true;
    this.drawLoop();

    // Capture composited video track from canvas
    const canvasStream = this.canvas.captureStream(this.frameRate);
    const compositedStream = new MediaStream();

    const videoTrack = canvasStream.getVideoTracks()[0];
    if (videoTrack) {
      compositedStream.addTrack(videoTrack);
    }

    this.outputStream = compositedStream;
    return compositedStream;
  }

  public setNormalizedPosition(pos: { x: number; y: number } | null) {
    this.customPosition = pos;
  }

  public setCorner(corner: BubbleCorner) {
    this.corner = corner;
    this.customPosition = null;
  }

  public setBubbleSize(size: BubbleSize) {
    this.size = size;
  }

  public setMirrored(mirrored: boolean) {
    this.isMirrored = mirrored;
  }

  public setCameraMuted(muted: boolean) {
    this.isCameraMuted = muted;
  }

  private getRadius(width: number, height: number): number {
    const minDim = Math.min(width, height);
    switch (this.size) {
      case "small":
        return minDim * 0.08;
      case "large":
        return minDim * 0.16;
      case "medium":
      default:
        return minDim * 0.12;
    }
  }

  private getBubbleCenter(
    width: number,
    height: number,
    radius: number
  ): { cx: number; cy: number } {
    const margin = radius * 0.25 + 24;

    if (this.customPosition) {
      const minX = radius + margin;
      const maxX = width - radius - margin;
      const minY = radius + margin;
      const maxY = height - radius - margin;

      const rawX = this.customPosition.x * width;
      const rawY = this.customPosition.y * height;

      return {
        cx: Math.min(Math.max(rawX, minX), maxX),
        cy: Math.min(Math.max(rawY, minY), maxY),
      };
    }

    switch (this.corner) {
      case "top-left":
        return { cx: margin + radius, cy: margin + radius };
      case "top-right":
        return { cx: width - margin - radius, cy: margin + radius };
      case "bottom-right":
        return {
          cx: width - margin - radius,
          cy: height - margin - radius,
        };
      case "bottom-left":
      default:
        return {
          cx: margin + radius,
          cy: height - margin - radius,
        };
    }
  }

  private drawLoop = () => {
    if (!this.isRunning) return;

    const width = this.canvas.width;
    const height = this.canvas.height;
    const ctx = this.ctx;

    // Draw screen video background
    if (this.screenVideo.readyState >= 2) {
      ctx.drawImage(this.screenVideo, 0, 0, width, height);
    } else {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);
    }

    // Draw camera bubble if camera stream is active and not muted
    if (
      !this.isCameraMuted &&
      this.cameraVideo &&
      this.cameraVideo.readyState >= 2 &&
      this.cameraVideo.videoWidth > 0
    ) {
      const radius = this.getRadius(width, height);
      const { cx, cy } = this.getBubbleCenter(width, height, radius);

      // Draw shadow circle
      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
      ctx.shadowBlur = radius * 0.2;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = radius * 0.08;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#1e1e2e";
      ctx.fill();
      ctx.restore();

      // Clip camera into circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();

      const camW = this.cameraVideo.videoWidth;
      const camH = this.cameraVideo.videoHeight;
      const minDim = Math.min(camW, camH);
      const sx = (camW - minDim) / 2;
      const sy = (camH - minDim) / 2;

      if (this.isMirrored) {
        ctx.translate(cx, cy);
        ctx.scale(-1, 1);
        ctx.drawImage(
          this.cameraVideo,
          sx,
          sy,
          minDim,
          minDim,
          -radius,
          -radius,
          radius * 2,
          radius * 2
        );
      } else {
        ctx.drawImage(
          this.cameraVideo,
          sx,
          sy,
          minDim,
          minDim,
          cx - radius,
          cy - radius,
          radius * 2,
          radius * 2
        );
      }
      ctx.restore();

      // Draw clean crisp white outline / ring
      ctx.save();
      ctx.lineWidth = Math.max(3, Math.round(radius * 0.04));
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    this.animationFrameId = requestAnimationFrame(this.drawLoop);
  };

  public stop() {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.screenVideo) {
      this.screenVideo.pause();
      this.screenVideo.srcObject = null;
    }

    if (this.cameraVideo) {
      this.cameraVideo.pause();
      this.cameraVideo.srcObject = null;
    }

    if (this.outputStream) {
      this.outputStream.getTracks().forEach((track) => track.stop());
      this.outputStream = null;
    }
  }
}
