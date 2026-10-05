import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  VideoCameraIcon,
  VideoCameraSlashIcon,
  ArrowsRightLeftIcon,
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
} from "@heroicons/react/24/outline";
import type { BubbleCorner, BubbleSize } from "./compositor";

interface CameraBubbleOverlayProps {
  stream: MediaStream | null;
  isMuted: boolean;
  isMirrored: boolean;
  bubbleCorner: BubbleCorner;
  bubbleSize: BubbleSize;
  onToggleMute: () => void;
  onToggleMirror: () => void;
  onChangeSize?: (size: BubbleSize) => void;
  onChangeCorner?: (corner: BubbleCorner) => void;
  onPositionChange: (pos: { x: number; y: number } | null) => void;
}

export default function CameraBubbleOverlay({
  stream,
  isMuted,
  isMirrored,
  bubbleCorner,
  bubbleSize,
  onToggleMute,
  onToggleMirror,
  onChangeSize,
  onChangeCorner,
  onPositionChange,
}: CameraBubbleOverlayProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [pixelPosition, setPixelPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [showControls, setShowControls] = useState(false);

  // Attach webcam stream to video element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {
        // Autoplay handled
      });
    }
  }, [stream]);

  // Size styling in pixels
  const getSizePx = useCallback(() => {
    switch (bubbleSize) {
      case "small":
        return 140;
      case "large":
        return 240;
      case "medium":
      default:
        return 190;
    }
  }, [bubbleSize]);

  const sizePx = getSizePx();

  // Corner default coordinates
  const getCornerDefaultPos = useCallback(
    (corner: BubbleCorner) => {
      const margin = 24;
      if (typeof window === "undefined") return { x: margin, y: margin };
      const w = window.innerWidth;
      const h = window.innerHeight;

      switch (corner) {
        case "top-left":
          return { x: margin, y: margin };
        case "top-right":
          return { x: w - sizePx - margin, y: margin };
        case "bottom-right":
          return { x: w - sizePx - margin, y: h - sizePx - margin };
        case "bottom-left":
        default:
          return { x: margin, y: h - sizePx - margin };
      }
    },
    [sizePx]
  );

  // Initialize or reset position on corner/size change if not dragging
  useEffect(() => {
    if (!pixelPosition) {
      const pos = getCornerDefaultPos(bubbleCorner);
      setPixelPosition(pos);
    }
  }, [bubbleCorner, getCornerDefaultPos, pixelPosition]);

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag with left click and not on a button
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    setIsDragging(true);

    const rect = bubbleRef.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;

      const w = window.innerWidth;
      const h = window.innerHeight;
      const rawX = e.clientX - dragOffset.x;
      const rawY = e.clientY - dragOffset.y;

      const boundedX = Math.max(12, Math.min(w - sizePx - 12, rawX));
      const boundedY = Math.max(12, Math.min(h - sizePx - 12, rawY));

      setPixelPosition({ x: boundedX, y: boundedY });

      // Calculate normalized center position (0 to 1)
      const centerX = (boundedX + sizePx / 2) / w;
      const centerY = (boundedY + sizePx / 2) / h;
      onPositionChange({ x: centerX, y: centerY });
    },
    [isDragging, dragOffset, sizePx, onPositionChange]
  );

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
    }
  }, [isDragging]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const cycleSize = () => {
    if (!onChangeSize) return;
    if (bubbleSize === "small") onChangeSize("medium");
    else if (bubbleSize === "medium") onChangeSize("large");
    else onChangeSize("small");
  };

  const resetToCorner = (corner: BubbleCorner) => {
    onChangeCorner?.(corner);
    setPixelPosition(null);
    onPositionChange(null);
  };

  if (!stream) return null;

  const currentPos = pixelPosition || getCornerDefaultPos(bubbleCorner);

  return (
    <div
      ref={bubbleRef}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
      style={{
        position: "fixed",
        left: `${currentPos.x}px`,
        top: `${currentPos.y}px`,
        width: `${sizePx}px`,
        height: `${sizePx}px`,
        zIndex: 99999,
        cursor: isDragging ? "grabbing" : "grab",
      }}
      className="group select-none"
    >
      {/* Camera Video / Mute View */}
      <div
        className={`relative h-full w-full overflow-hidden rounded-full border-4 border-white bg-gray-900 shadow-2xl ring-2 ring-indigo-500/30 transition-transform duration-100 ${
          isDragging ? "scale-105" : "hover:scale-[1.02]"
        }`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${
            isMirrored ? "-scale-x-100" : ""
          } ${isMuted ? "opacity-20" : "opacity-100"}`}
        />

        {isMuted ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/80 text-white">
            <VideoCameraSlashIcon className="h-8 w-8 text-red-400" />
            <span className="mt-1 text-xs font-semibold uppercase tracking-wider text-gray-300">
              Camera Off
            </span>
          </div>
        ) : null}
      </div>

      {/* Floating Toolbar on Hover */}
      <div
        className={`absolute -bottom-10 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-gray-900/90 px-2.5 py-1 text-white shadow-lg backdrop-blur transition-all duration-200 ${
          showControls || isDragging
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-1 opacity-0"
        }`}
      >
        <button
          type="button"
          onClick={onToggleMute}
          title={isMuted ? "Turn camera on" : "Turn camera off"}
          className="rounded-full p-1.5 transition hover:bg-white/20 active:scale-95"
        >
          {isMuted ? (
            <VideoCameraSlashIcon className="h-4 w-4 text-red-400" />
          ) : (
            <VideoCameraIcon className="h-4 w-4 text-white" />
          )}
        </button>

        <button
          type="button"
          onClick={onToggleMirror}
          title="Flip mirror"
          className="rounded-full p-1.5 transition hover:bg-white/20 active:scale-95"
        >
          <ArrowsRightLeftIcon className="h-4 w-4 text-white" />
        </button>

        {onChangeSize ? (
          <button
            type="button"
            onClick={cycleSize}
            title={`Size: ${bubbleSize}`}
            className="rounded-full p-1.5 transition hover:bg-white/20 active:scale-95"
          >
            {bubbleSize === "large" ? (
              <ArrowsPointingInIcon className="h-4 w-4 text-white" />
            ) : (
              <ArrowsPointingOutIcon className="h-4 w-4 text-white" />
            )}
          </button>
        ) : null}

        {onChangeCorner ? (
          <div className="ml-0.5 flex gap-0.5 border-l border-white/20 pl-1">
            <button
              type="button"
              onClick={() => resetToCorner("bottom-left")}
              title="Snap to bottom-left"
              className={`rounded px-1 text-[10px] uppercase font-bold transition hover:bg-white/20 ${
                bubbleCorner === "bottom-left" && !pixelPosition
                  ? "text-indigo-400"
                  : "text-gray-400"
              }`}
            >
              BL
            </button>
            <button
              type="button"
              onClick={() => resetToCorner("bottom-right")}
              title="Snap to bottom-right"
              className={`rounded px-1 text-[10px] uppercase font-bold transition hover:bg-white/20 ${
                bubbleCorner === "bottom-right" && !pixelPosition
                  ? "text-indigo-400"
                  : "text-gray-400"
              }`}
            >
              BR
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
