import React, { useState, useRef, Fragment } from "react";
import { Listbox, Transition, Switch } from "@headlessui/react";
import { CheckIcon, ChevronUpDownIcon } from "@heroicons/react/20/solid";
import {
  MicrophoneIcon,
  VideoCameraIcon,
  PauseIcon,
} from "@heroicons/react/24/outline";
import { ResumeIcon, TrashIcon } from "@radix-ui/react-icons";
import { StopIcon } from "@heroicons/react/24/solid";
import dayjs from "dayjs";
import { invokeSaveAsDialog } from "recordrtc";
import Tooltip from "~/components/Tooltip";
import StopTime from "~/components/StopTime";
import VideoPlayer from "~/components/VideoPlayer";
import { useScreenRecorder } from "./useScreenRecorder";
import CameraBubbleOverlay from "./CameraBubbleOverlay";
import type { BubbleCorner, BubbleSize } from "./compositor";

export interface SnapifyRecorderProps {
  onSave?: (blob: Blob) => void;
  onUpload?: (blob: Blob) => Promise<void>;
  onClose?: () => void;
  defaultCorner?: BubbleCorner;
  defaultSize?: BubbleSize;
  defaultMirrored?: boolean;
  defaultCameraEnabled?: boolean;
  uploadButtonText?: string;
  className?: string;
}

export function SnapifyRecorder({
  onSave,
  onUpload,
  onClose,
  defaultCorner = "bottom-left",
  defaultSize = "medium",
  defaultMirrored = true,
  defaultCameraEnabled = true,
  uploadButtonText = "Save to cloud",
  className = "",
}: SnapifyRecorderProps) {
  const [submitting, setSubmitting] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const {
    status,
    blob,
    duration,
    audioDevices,
    videoDevices,
    selectedAudioDevice,
    selectedVideoDevice,
    isCameraEnabled,
    isCameraMuted,
    isMirrored,
    bubbleCorner,
    bubbleSize,
    cameraStream,
    setSelectedAudioDevice,
    setSelectedVideoDevice,
    setIsCameraEnabled,
    setIsCameraMuted,
    setIsMirrored,
    setBubbleCorner,
    setBubbleSize,
    setNormalizedPosition,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    cancelRecording,
    reset,
  } = useScreenRecorder({
    defaultCorner,
    defaultSize,
    defaultMirrored,
  });

  // Keep camera enabled state synced with default prop on initial load
  useState(() => {
    setIsCameraEnabled(defaultCameraEnabled);
  });

  const handleStart = async () => {
    try {
      await startRecording();
    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  };

  const handleStop = async () => {
    await stopRecording();
  };

  const handleDownload = () => {
    if (!blob) return;
    const filename = `Snapify Recording - ${dayjs().format(
      "D MMM YYYY"
    )}.webm`;
    if (onSave) {
      onSave(blob);
    } else {
      invokeSaveAsDialog(blob, filename);
    }
  };

  const handleUploadClick = async () => {
    if (!blob || !onUpload) return;
    setSubmitting(true);
    try {
      await onUpload(blob);
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = () => {
    cancelRecording();
    onClose?.();
  };

  const renderPreRecording = () => (
    <div className="w-full space-y-4">
      {/* Microphone Selector */}
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
          Microphone
        </label>
        <Listbox
          value={selectedAudioDevice}
          onChange={setSelectedAudioDevice}
        >
          <div className="relative">
            <Listbox.Button className="relative flex w-full cursor-default flex-row items-center justify-start rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-10 text-left text-sm shadow-sm transition hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <MicrophoneIcon
                className="mr-2 h-5 w-5 text-gray-400"
                aria-hidden="true"
              />
              <span className="block truncate text-gray-800">
                {selectedAudioDevice?.label || "Default Microphone"}
              </span>
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                <ChevronUpDownIcon
                  className="h-5 w-5 text-gray-400"
                  aria-hidden="true"
                />
              </span>
            </Listbox.Button>
            <Transition
              as={Fragment}
              leave="transition ease-in duration-100"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <Listbox.Options className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                {audioDevices.map((device, i) => (
                  <Listbox.Option
                    key={device.deviceId || i}
                    className={({ active }) =>
                      `relative cursor-default select-none py-2 pl-10 pr-4 ${
                        active
                          ? "bg-indigo-50 text-indigo-900"
                          : "text-gray-900"
                      }`
                    }
                    value={device}
                  >
                    {({ selected }) => (
                      <>
                        <span
                          className={`block truncate ${
                            selected ? "font-semibold" : "font-normal"
                          }`}
                        >
                          {device.label || `Microphone ${i + 1}`}
                        </span>
                        {selected ? (
                          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-indigo-600">
                            <CheckIcon className="h-5 w-5" aria-hidden="true" />
                          </span>
                        ) : null}
                      </>
                    )}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </Transition>
          </div>
        </Listbox>
      </div>

      {/* Camera Selector & Toggle */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Camera Bubble
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {isCameraEnabled ? "On" : "Off"}
            </span>
            <Switch
              checked={isCameraEnabled}
              onChange={setIsCameraEnabled}
              className={`${
                isCameraEnabled ? "bg-indigo-600" : "bg-gray-200"
              } relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none`}
            >
              <span
                className={`${
                  isCameraEnabled ? "translate-x-4" : "translate-x-0"
                } pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
              />
            </Switch>
          </div>
        </div>

        {isCameraEnabled ? (
          <Listbox
            value={selectedVideoDevice}
            onChange={setSelectedVideoDevice}
          >
            <div className="relative">
              <Listbox.Button className="relative flex w-full cursor-default flex-row items-center justify-start rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-10 text-left text-sm shadow-sm transition hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <VideoCameraIcon
                  className="mr-2 h-5 w-5 text-gray-400"
                  aria-hidden="true"
                />
                <span className="block truncate text-gray-800">
                  {selectedVideoDevice?.label || "Default Camera"}
                </span>
                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                  <ChevronUpDownIcon
                    className="h-5 w-5 text-gray-400"
                    aria-hidden="true"
                  />
                </span>
              </Listbox.Button>
              <Transition
                as={Fragment}
                leave="transition ease-in duration-100"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
              >
                <Listbox.Options className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                  {videoDevices.length === 0 ? (
                    <div className="py-2 px-3 text-sm text-gray-500">
                      No cameras detected
                    </div>
                  ) : (
                    videoDevices.map((device, i) => (
                      <Listbox.Option
                        key={device.deviceId || i}
                        className={({ active }) =>
                          `relative cursor-default select-none py-2 pl-10 pr-4 ${
                            active
                              ? "bg-indigo-50 text-indigo-900"
                              : "text-gray-900"
                          }`
                        }
                        value={device}
                      >
                        {({ selected }) => (
                          <>
                            <span
                              className={`block truncate ${
                                selected ? "font-semibold" : "font-normal"
                              }`}
                            >
                              {device.label || `Camera ${i + 1}`}
                            </span>
                            {selected ? (
                              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-indigo-600">
                                <CheckIcon
                                  className="h-5 w-5"
                                  aria-hidden="true"
                                />
                              </span>
                            ) : null}
                          </>
                        )}
                      </Listbox.Option>
                    ))
                  )}
                </Listbox.Options>
              </Transition>
            </div>
          </Listbox>
        ) : null}
      </div>

      {/* Camera Bubble Position Preference */}
      {isCameraEnabled ? (
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
            Initial Bubble Position
          </label>
          <div className="grid grid-cols-4 gap-1.5 text-xs">
            {(
              [
                ["bottom-left", "Bottom Left"],
                ["bottom-right", "Bottom Right"],
                ["top-left", "Top Left"],
                ["top-right", "Top Right"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setBubbleCorner(val)}
                className={`rounded-md border py-1.5 px-2 font-medium transition ${
                  bubbleCorner === val
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold leading-6 text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        onClick={() => void handleStart()}
      >
        <span>Start recording</span>
      </button>
    </div>
  );

  const renderInRecording = () => (
    <div className="flex flex-row items-center justify-center py-2">
      <Tooltip title="Finish recording">
        <div
          onClick={() => void handleStop()}
          className="flex cursor-pointer flex-row items-center justify-center rounded pr-2 text-lg hover:bg-gray-100"
        >
          <StopIcon className="h-8 w-8 text-[#ff623f]" aria-hidden="true" />
          <StopTime running={status === "recording"} duration={duration} />
        </div>
      </Tooltip>
      <div className="mx-3 h-6 w-px bg-gray-200" />
      <Tooltip title={status === "paused" ? "Resume" : "Pause"}>
        <div
          onClick={status === "paused" ? resumeRecording : pauseRecording}
          className="cursor-pointer rounded p-1.5 hover:bg-gray-100"
        >
          {status === "paused" ? (
            <ResumeIcon
              className="h-6 w-6 text-gray-500"
              aria-hidden="true"
            />
          ) : (
            <PauseIcon className="h-6 w-6 text-gray-500" aria-hidden="true" />
          )}
        </div>
      </Tooltip>
      <Tooltip title="Cancel recording">
        <div
          onClick={handleDelete}
          className="ml-1 cursor-pointer rounded p-1.5 hover:bg-gray-100"
        >
          <TrashIcon className="h-6 w-6 text-gray-500" aria-hidden="true" />
        </div>
      </Tooltip>
    </div>
  );

  const renderPostRecording = () => (
    <div>
      {blob ? (
        <div className="mb-4 aspect-video max-h-[70vh] max-w-[70vw] overflow-hidden rounded-lg bg-black shadow-lg">
          <VideoPlayer video_url={URL.createObjectURL(blob)} />
          <video
            src={URL.createObjectURL(blob)}
            ref={videoRef}
            className="absolute hidden"
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        {onUpload ? (
          <button
            type="button"
            className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
            disabled={submitting}
            onClick={() => void handleUploadClick()}
          >
            {submitting ? "Uploading..." : uploadButtonText}
          </button>
        ) : null}

        <button
          type="button"
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
          onClick={handleDownload}
        >
          Download to device
        </button>

        <button
          type="button"
          className="ml-auto inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500"
          onClick={() => {
            reset();
            onClose?.();
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );

  return (
    <div className={`snapify-recorder ${className}`}>
      {status === "idle" && renderPreRecording()}
      {(status === "recording" || status === "paused") && renderInRecording()}
      {status === "stopped" && renderPostRecording()}

      {/* Floating draggable camera overlay while recording */}
      {(status === "recording" || status === "paused") &&
        cameraStream &&
        isCameraEnabled && (
          <CameraBubbleOverlay
            stream={cameraStream}
            isMuted={isCameraMuted}
            isMirrored={isMirrored}
            bubbleCorner={bubbleCorner}
            bubbleSize={bubbleSize}
            onToggleMute={() => setIsCameraMuted(!isCameraMuted)}
            onToggleMirror={() => setIsMirrored(!isMirrored)}
            onChangeSize={setBubbleSize}
            onChangeCorner={setBubbleCorner}
            onPositionChange={setNormalizedPosition}
          />
        )}
    </div>
  );
}

export default SnapifyRecorder;
