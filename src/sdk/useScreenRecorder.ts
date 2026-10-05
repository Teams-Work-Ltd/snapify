import { useState, useRef, useEffect, useCallback } from "react";
import RecordRTC from "recordrtc";
import {
  CanvasCompositor,
  type BubbleCorner,
  type BubbleSize,
} from "./compositor";
import { makeSeekableWebm } from "./webmUtils";

export type RecorderStatus = "idle" | "recording" | "paused" | "stopped";

export interface UseScreenRecorderOptions {
  defaultCorner?: BubbleCorner;
  defaultSize?: BubbleSize;
  defaultMirrored?: boolean;
  onStop?: (blob: Blob) => void;
  onError?: (error: Error) => void;
}

export function useScreenRecorder(options: UseScreenRecorderOptions = {}) {
  const {
    defaultCorner = "bottom-left",
    defaultSize = "medium",
    defaultMirrored = true,
    onStop,
    onError,
  } = options;

  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [error, setError] = useState<Error | null>(null);

  // Device lists and selection
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDevice, setSelectedAudioDevice] =
    useState<MediaDeviceInfo | null>(null);
  const [selectedVideoDevice, setSelectedVideoDevice] =
    useState<MediaDeviceInfo | null>(null);
  const [isCameraEnabled, setIsCameraEnabled] = useState<boolean>(true);

  // Bubble configuration
  const [bubbleCorner, setBubbleCorner] = useState<BubbleCorner>(defaultCorner);
  const [bubbleSize, setBubbleSize] = useState<BubbleSize>(defaultSize);
  const [isMirrored, setIsMirrored] = useState<boolean>(defaultMirrored);
  const [isCameraMuted, setIsCameraMuted] = useState<boolean>(false);
  const [normalizedPosition, setNormalizedPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Active streams and objects
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);

  const recorderRef = useRef<RecordRTC | null>(null);
  const compositorRef = useRef<CanvasCompositor | null>(null);
  const durationTimerRef = useRef<number | null>(null);
  const durationRef = useRef<number>(0);
  const activeStreamsRef = useRef<MediaStream[]>([]);

  // Keep durationRef in sync
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // Enumerate devices on mount
  const refreshDevices = useCallback(async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices) return;

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === "audioinput");
      const videoInputs = devices.filter((d) => d.kind === "videoinput");

      setAudioDevices(audioInputs);
      setVideoDevices(videoInputs);

      setSelectedAudioDevice((prev) => prev ?? audioInputs[0] ?? null);
      setSelectedVideoDevice((prev) => prev ?? videoInputs[0] ?? null);
    } catch (err) {
      console.warn("Error enumerating devices:", err);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const handleDeviceChange = () => {
      void refreshDevices();
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        handleDeviceChange
      );
    };
  }, [refreshDevices]);

  // Request initial permissions to get device labels if needed
  const requestPermissions = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      stream.getTracks().forEach((track) => track.stop());
      await refreshDevices();
    } catch {
      // User may have denied one of the permissions, fallback to audio only
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        audioStream.getTracks().forEach((track) => track.stop());
        await refreshDevices();
      } catch {
        // Permissions not granted yet
      }
    }
  }, [refreshDevices]);

  // Real-time synchronization of compositor controls
  useEffect(() => {
    if (compositorRef.current) {
      compositorRef.current.setNormalizedPosition(normalizedPosition);
    }
  }, [normalizedPosition]);

  useEffect(() => {
    if (compositorRef.current) {
      compositorRef.current.setCorner(bubbleCorner);
    }
  }, [bubbleCorner]);

  useEffect(() => {
    if (compositorRef.current) {
      compositorRef.current.setBubbleSize(bubbleSize);
    }
  }, [bubbleSize]);

  useEffect(() => {
    if (compositorRef.current) {
      compositorRef.current.setMirrored(isMirrored);
    }
  }, [isMirrored]);

  useEffect(() => {
    if (compositorRef.current) {
      compositorRef.current.setCameraMuted(isCameraMuted);
    }
  }, [isCameraMuted]);

  // Cleanup helper
  const cleanupStreams = useCallback(() => {
    if (durationTimerRef.current !== null) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    if (compositorRef.current) {
      compositorRef.current.stop();
      compositorRef.current = null;
    }

    activeStreamsRef.current.forEach((st) => {
      st.getTracks().forEach((track) => track.stop());
    });
    activeStreamsRef.current = [];

    setCameraStream(null);
    setScreenStream(null);
  }, []);

  // Stop recording
  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    if (!recorderRef.current) return null;

    if (durationTimerRef.current !== null) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    return new Promise<Blob | null>((resolve) => {
      recorderRef.current?.stopRecording(() => {
        void (async () => {
          try {
            const rawBlob = recorderRef.current?.getBlob();
            if (rawBlob) {
              const seekable = await makeSeekableWebm(
                rawBlob,
                durationRef.current
              );
              setBlob(seekable);
              setStatus("stopped");
              onStop?.(seekable);
              resolve(seekable);
            } else {
              setStatus("stopped");
              resolve(null);
            }
          } catch (err) {
            const errorObj =
              err instanceof Error ? err : new Error(String(err));
            setError(errorObj);
            onError?.(errorObj);
            setStatus("stopped");
            resolve(null);
          } finally {
            cleanupStreams();
          }
        })();
      });
    });
  }, [cleanupStreams, onStop, onError]);

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setBlob(null);
      setDuration(0);
      durationRef.current = 0;

      // 1. Capture screen
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: 1920,
          height: 1080,
          frameRate: 30,
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      });
      setScreenStream(screen);
      activeStreamsRef.current.push(screen);

      // Listen for screen sharing termination from browser UI
      const firstVideoTrack = screen.getVideoTracks()[0];
      if (firstVideoTrack) {
        firstVideoTrack.addEventListener("ended", () => {
          void stopRecording();
        });
      }

      // 2. Capture microphone
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: selectedAudioDevice
            ? { deviceId: { exact: selectedAudioDevice.deviceId } }
            : true,
        });
        activeStreamsRef.current.push(micStream);
      } catch (micErr) {
        console.warn("Microphone access failed or denied:", micErr);
      }

      // 3. Capture camera if enabled
      let camStream: MediaStream | null = null;
      if (isCameraEnabled) {
        try {
          camStream = await navigator.mediaDevices.getUserMedia({
            video: selectedVideoDevice
              ? {
                  deviceId: { exact: selectedVideoDevice.deviceId },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                }
              : { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
          setCameraStream(camStream);
          activeStreamsRef.current.push(camStream);
        } catch (camErr) {
          console.warn("Camera access failed or denied:", camErr);
        }
      }

      // 4. Composite or combine streams
      let recordingStream: MediaStream;

      if (camStream) {
        const compositor = new CanvasCompositor({
          screenStream: screen,
          cameraStream: camStream,
          corner: bubbleCorner,
          normalizedPosition: normalizedPosition ?? undefined,
          size: bubbleSize,
          mirrored: isMirrored,
          cameraMuted: isCameraMuted,
          frameRate: 30,
        });
        compositorRef.current = compositor;
        const compositedVideo = await compositor.start();

        recordingStream = new MediaStream();
        compositedVideo
          .getVideoTracks()
          .forEach((t) => recordingStream.addTrack(t));
      } else {
        recordingStream = new MediaStream();
        screen.getVideoTracks().forEach((t) => recordingStream.addTrack(t));
      }

      // Add audio tracks (mic + system audio)
      if (micStream) {
        micStream.getAudioTracks().forEach((t) => recordingStream.addTrack(t));
      }
      screen.getAudioTracks().forEach((t) => recordingStream.addTrack(t));

      // 5. Initialize RecordRTC
      const recorder = new RecordRTC(recordingStream, {
        type: "video",
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        mimeType: 'video/webm;codecs="vp9,opus"',
      });

      recorder.startRecording();
      recorderRef.current = recorder;
      setStatus("recording");

      // Start duration timer
      durationTimerRef.current = window.setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      cleanupStreams();
      const errorObj = err instanceof Error ? err : new Error(String(err));
      setError(errorObj);
      onError?.(errorObj);
      setStatus("idle");
      throw errorObj;
    }
  }, [
    selectedAudioDevice,
    selectedVideoDevice,
    isCameraEnabled,
    bubbleCorner,
    normalizedPosition,
    bubbleSize,
    isMirrored,
    isCameraMuted,
    stopRecording,
    cleanupStreams,
    onError,
  ]);

  const pauseRecording = useCallback(() => {
    if (recorderRef.current && status === "recording") {
      recorderRef.current.pauseRecording();
      setStatus("paused");
      if (durationTimerRef.current !== null) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    }
  }, [status]);

  const resumeRecording = useCallback(() => {
    if (recorderRef.current && status === "paused") {
      recorderRef.current.resumeRecording();
      setStatus("recording");
      durationTimerRef.current = window.setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    }
  }, [status]);

  const cancelRecording = useCallback(() => {
    if (recorderRef.current) {
      try {
        recorderRef.current.stopRecording(() => {
          cleanupStreams();
        });
      } catch {
        cleanupStreams();
      }
    } else {
      cleanupStreams();
    }
    setBlob(null);
    setDuration(0);
    durationRef.current = 0;
    setStatus("idle");
  }, [cleanupStreams]);

  const reset = useCallback(() => {
    cleanupStreams();
    setBlob(null);
    setDuration(0);
    durationRef.current = 0;
    setError(null);
    setStatus("idle");
  }, [cleanupStreams]);

  return {
    // State
    status,
    blob,
    duration,
    error,
    audioDevices,
    videoDevices,
    selectedAudioDevice,
    selectedVideoDevice,
    isCameraEnabled,
    isCameraMuted,
    isMirrored,
    bubbleCorner,
    bubbleSize,
    normalizedPosition,
    cameraStream,
    screenStream,

    // Actions
    setSelectedAudioDevice,
    setSelectedVideoDevice,
    setIsCameraEnabled,
    setIsCameraMuted,
    setIsMirrored,
    setBubbleCorner,
    setBubbleSize,
    setNormalizedPosition,
    requestPermissions,
    refreshDevices,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    cancelRecording,
    reset,
  };
}
