import React, { useState, useRef, Fragment, useEffect, useCallback } from "react";
import RecordRTC, { invokeSaveAsDialog } from "recordrtc";
import { Listbox, Transition, Switch } from "@headlessui/react";
import { CheckIcon, ChevronUpDownIcon } from "@heroicons/react/20/solid";
import {
  MicrophoneIcon,
  PauseIcon,
  VideoCameraIcon,
} from "@heroicons/react/24/outline";
import { ResumeIcon, TrashIcon } from "@radix-ui/react-icons";
import { StopIcon } from "@heroicons/react/24/solid";
import StopTime from "~/components/StopTime";
import axios from "axios";
import dayjs from "dayjs";
import { useRouter } from "next/router";
import { api } from "~/utils/api";
import { TRPCClientError } from "@trpc/client";
import { useAtom } from "jotai";
import paywallAtom from "~/atoms/paywallAtom";
import recordVideoModalOpen from "~/atoms/recordVideoModalOpen";
import { usePostHog } from "posthog-js/react";
import Tooltip from "~/components/Tooltip";
import generateThumbnail from "~/utils/generateThumbnail";
import VideoPlayer from "~/components/VideoPlayer";
import {
  CanvasCompositor,
  type BubbleCorner,
  type BubbleSize,
} from "~/sdk/compositor";
import CameraBubbleOverlay from "~/sdk/CameraBubbleOverlay";
import { makeSeekableWebm } from "~/sdk/webmUtils";

interface Props {
  closeModal: () => void;
  step: string;
  setStep: (
    value:
      | ((prevState: "pre" | "in" | "post") => "pre" | "in" | "post")
      | "pre"
      | "in"
      | "post"
  ) => void;
}

export default function Recorder({ closeModal, step, setStep }: Props) {
  const [blob, setBlob] = useState<null | Blob>(null);
  const recorderRef = useRef<null | RecordRTC>(null);
  const compositorRef = useRef<null | CanvasCompositor>(null);
  const activeStreamsRef = useRef<MediaStream[]>([]);
  const [pause, setPause] = useState<boolean>(false);

  // Audio and camera devices
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDevice, setSelectedAudioDevice] =
    useState<MediaDeviceInfo | null>(null);
  const [selectedCameraDevice, setSelectedCameraDevice] =
    useState<MediaDeviceInfo | null>(null);
  const [isCameraEnabled, setIsCameraEnabled] = useState<boolean>(true);

  // Bubble settings
  const [bubbleCorner, setBubbleCorner] = useState<BubbleCorner>("bottom-left");
  const [bubbleSize, setBubbleSize] = useState<BubbleSize>("medium");
  const [isMirrored, setIsMirrored] = useState<boolean>(true);
  const [isCameraMuted, setIsCameraMuted] = useState<boolean>(false);
  const [normalizedPosition, setNormalizedPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  const router = useRouter();
  const [, setRecordOpen] = useAtom(recordVideoModalOpen);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const apiUtils = api.useContext();
  const getSignedUrl = api.video.getUploadUrl.useMutation();
  const [duration, setDuration] = useState<number>(0);
  const durationRef = useRef<number>(0);
  const [, setPaywallOpen] = useAtom(paywallAtom);
  const videoRef = useRef<null | HTMLVideoElement>(null);
  const posthog = usePostHog();

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const cleanup = useCallback(() => {
    if (compositorRef.current) {
      compositorRef.current.stop();
      compositorRef.current = null;
    }

    activeStreamsRef.current.forEach((stream) => {
      stream.getTracks().forEach((track) => track.stop());
    });
    activeStreamsRef.current = [];

    setCameraStream(null);
  }, []);

  const handleRecording = async () => {
    try {
      // 1. Screen capture
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
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

      // 2. Microphone capture
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: selectedAudioDevice?.deviceId
            ? { deviceId: { exact: selectedAudioDevice.deviceId } }
            : true,
        });
      } catch (error) {
        console.error("Failed to access microphone:", error);
      }

      // 3. Camera capture if enabled
      let camStream: MediaStream | null = null;
      if (isCameraEnabled) {
        try {
          camStream = await navigator.mediaDevices.getUserMedia({
            video: selectedCameraDevice?.deviceId
              ? {
                  deviceId: { exact: selectedCameraDevice.deviceId },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                }
              : { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
          setCameraStream(camStream);
        } catch (error) {
          console.error("Failed to access camera:", error);
        }
      }

      // 4. Composite streams if camera is active
      let recordingStream: MediaStream;
      if (camStream) {
        const compositor = new CanvasCompositor({
          screenStream,
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
          .forEach((track) => recordingStream.addTrack(track));
      } else {
        recordingStream = new MediaStream();
        screenStream
          .getVideoTracks()
          .forEach((track) => recordingStream.addTrack(track));
      }

      // Add audio tracks (mic + screen audio)
      if (micStream) {
        micStream
          .getAudioTracks()
          .forEach((track) => recordingStream.addTrack(track));
      }
      screenStream
        .getAudioTracks()
        .forEach((track) => recordingStream.addTrack(track));

      const firstVideoTrack = screenStream.getVideoTracks()[0];
      if (firstVideoTrack) {
        firstVideoTrack.addEventListener("ended", () => handleStop());
      }

      const streamsToTrack = [screenStream];
      if (micStream) streamsToTrack.push(micStream);
      if (camStream) streamsToTrack.push(camStream);
      activeStreamsRef.current = streamsToTrack;

      recorderRef.current = new RecordRTC(recordingStream, {
        type: "video",
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        mimeType: 'video/webm;codecs="vp9,opus"',
      });
      recorderRef.current.startRecording();

      setStep("in");
      posthog?.capture("recorder: start video recording", {
        withCamera: !!camStream,
      });
    } catch (err) {
      console.error("Failed to start recording:", err);
      cleanup();
    }
  };

  const handleStop = () => {
    if (recorderRef.current === null) return;
    recorderRef.current.stopRecording(() => {
      void (async () => {
        try {
          const rawBlob = recorderRef.current?.getBlob();
          if (rawBlob) {
            const fixedBlob = await makeSeekableWebm(
              rawBlob,
              durationRef.current
            );
            setBlob(fixedBlob);
          }
        } catch (err) {
          console.error("Error finalizing seekable WebM:", err);
        } finally {
          cleanup();
          setStep("post");
          posthog?.capture("recorder: video recording finished");
        }
      })();
    });
  };

  const handleDelete = () => {
    if (recorderRef.current) {
      try {
        recorderRef.current.stopRecording(() => {
          cleanup();
        });
      } catch {
        cleanup();
      }
    } else {
      cleanup();
    }

    setBlob(null);
    setDuration(0);
    durationRef.current = 0;
    closeModal();
    setStep("pre");

    posthog?.capture("recorder: video deleted");
  };

  const handlePause = () => {
    if (recorderRef.current) {
      if (pause) {
        recorderRef.current?.resumeRecording();
      } else {
        recorderRef.current.pauseRecording();
      }
      posthog?.capture("recorder: recording paused/resumed", { pause });
      setPause(!pause);
    }
  };

  useEffect(() => {
    async function getDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audios = devices.filter(
          (device) => device.kind === "audioinput"
        );
        const videos = devices.filter(
          (device) => device.kind === "videoinput"
        );

        setAudioDevices(audios);
        setVideoDevices(videos);

        if (audios[0]) setSelectedAudioDevice(audios[0]);
        if (videos[0]) setSelectedCameraDevice(videos[0]);
      } catch (error) {
        console.error("Device enumeration error:", error);
      }
    }

    void getDevices();
  }, []);

  const handleSave = () => {
    if (blob) {
      const dateString =
        "Snapify Recording - " + dayjs().format("D MMM YYYY") + ".webm";
      invokeSaveAsDialog(blob, dateString);
    }

    posthog?.capture("recorder: video downloaded");
  };

  const handleUpload = async () => {
    if (!blob || !videoRef.current) return;

    const dateString =
      "Snapify Recording - " + dayjs().format("D MMM YYYY") + ".webm";
    setSubmitting(true);

    try {
      const { signedVideoUrl, signedThumbnailUrl, id } =
        await getSignedUrl.mutateAsync({
          key: dateString,
        });

      await axios
        .put(signedVideoUrl, blob.slice(), {
          headers: { "Content-Type": "video/webm" },
        })
        .then(async () => {
          if (!videoRef.current) return;
          return axios.put(
            signedThumbnailUrl,
            await generateThumbnail(videoRef.current),
            {
              headers: { "Content-Type": "image/png" },
            }
          );
        })
        .then(() => {
          void router.push("share/" + id);
          setRecordOpen(false);
          posthog?.capture("recorder: video uploaded");
        })
        .catch((err) => {
          console.error(err);
        });
    } catch (err) {
      if (err instanceof TRPCClientError) {
        if (
          err.message ===
          "Sorry, you have reached the maximum video upload limit on our free tier. Please upgrade to upload more."
        ) {
          posthog?.capture("recorder: video upload paywall hit");
          setPaywallOpen(true);
        } else if (err.message === "UNAUTHORIZED") {
          window.open(
            `/sign-in?redirect=${encodeURIComponent("/window-close")}`,
            "Sign In",
            "width=500,height=500"
          );
          posthog?.capture("recorder: guest tried to upload");
        }
      } else {
        throw err;
      }
    } finally {
      setSubmitting(false);
    }

    void apiUtils.video.getAll.invalidate();
  };

  return (
    <div>
      {step === "pre" ? (
        <div className="w-full space-y-4 min-w-[280px] sm:min-w-[340px]">
          {/* Audio Input Device */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Microphone
            </label>
            <Listbox
              value={selectedAudioDevice}
              onChange={setSelectedAudioDevice}
            >
              <div className="relative">
                <Listbox.Button className="relative flex w-full cursor-default flex-row items-center justify-start rounded-lg bg-white py-2 pl-3 pr-10 text-left shadow-sm border border-gray-200 focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500 sm:text-sm">
                  <MicrophoneIcon
                    className="mr-2 h-5 w-5 text-gray-400"
                    aria-hidden="true"
                  />
                  <span className="block truncate">
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
                  enter="ease-out duration-300"
                  enterFrom="opacity-0"
                  enterTo="opacity-100"
                  leave="ease-in duration-200"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                >
                  <Listbox.Options className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                    {audioDevices.map((audioDevice, i) => (
                      <Listbox.Option
                        key={audioDevice.deviceId || i}
                        className={({ active }) =>
                          `relative cursor-default select-none py-2 pl-10 pr-4 text-gray-900 ${
                            active ? "bg-gray-100" : ""
                          }`
                        }
                        value={audioDevice}
                      >
                        {({ selected }) => (
                          <>
                            <span
                              className={`block truncate ${
                                selected ? "font-medium" : "font-normal"
                              }`}
                            >
                              {audioDevice.label || `Microphone ${i + 1}`}
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
                    ))}
                  </Listbox.Options>
                </Transition>
              </div>
            </Listbox>
          </div>

          {/* Camera Input Device & Toggle */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Camera Presenter
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
                value={selectedCameraDevice}
                onChange={setSelectedCameraDevice}
              >
                <div className="relative">
                  <Listbox.Button className="relative flex w-full cursor-default flex-row items-center justify-start rounded-lg bg-white py-2 pl-3 pr-10 text-left shadow-sm border border-gray-200 focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500 sm:text-sm">
                    <VideoCameraIcon
                      className="mr-2 h-5 w-5 text-gray-400"
                      aria-hidden="true"
                    />
                    <span className="block truncate">
                      {selectedCameraDevice?.label || "Default Camera"}
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
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                  >
                    <Listbox.Options className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                      {videoDevices.map((device, i) => (
                        <Listbox.Option
                          key={device.deviceId || i}
                          className={({ active }) =>
                            `relative cursor-default select-none py-2 pl-10 pr-4 text-gray-900 ${
                              active ? "bg-gray-100" : ""
                            }`
                          }
                          value={device}
                        >
                          {({ selected }) => (
                            <>
                              <span
                                className={`block truncate ${
                                  selected ? "font-medium" : "font-normal"
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
                      ))}
                    </Listbox.Options>
                  </Transition>
                </div>
              </Listbox>
            ) : null}
          </div>

          {/* Initial Bubble Corner Preference */}
          {isCameraEnabled ? (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                Bubble Corner
              </label>
              <div className="grid grid-cols-4 gap-1.5 text-xs">
                {(
                  [
                    ["bottom-left", "BL"],
                    ["bottom-right", "BR"],
                    ["top-left", "TL"],
                    ["top-right", "TR"],
                  ] as const
                ).map(([cornerVal, label]) => (
                  <button
                    key={cornerVal}
                    type="button"
                    onClick={() => setBubbleCorner(cornerVal)}
                    className={`rounded border py-1.5 font-medium transition ${
                      bubbleCorner === cornerVal
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
            className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold leading-6 text-white shadow transition duration-150 ease-in-out hover:bg-indigo-500 disabled:cursor-not-allowed"
            onClick={() => void handleRecording()}
          >
            <span>Start recording</span>
          </button>
        </div>
      ) : null}

      {step === "in" ? (
        <>
          <div className="flex flex-row items-center justify-center">
            <Tooltip title="Finish recording">
              <div
                onClick={handleStop}
                className="flex cursor-pointer flex-row items-center justify-center rounded pr-2 text-lg hover:bg-gray-200"
              >
                <StopIcon
                  className="h-8 w-8 text-[#ff623f]"
                  aria-hidden="true"
                />
                <StopTime
                  running={!pause}
                  duration={duration}
                  setDuration={setDuration}
                />
              </div>
            </Tooltip>
            <div className="mx-2 h-6 w-px bg-[#E7E9EB]"></div>
            <Tooltip title={pause ? "Resume" : "Pause"}>
              <div
                onClick={handlePause}
                className="cursor-pointer rounded p-1 hover:bg-gray-200"
              >
                {pause ? (
                  <ResumeIcon
                    className="h-6 w-6 text-gray-400"
                    aria-hidden="true"
                  />
                ) : (
                  <PauseIcon
                    className="h-6 w-6 text-gray-400"
                    aria-hidden="true"
                  />
                )}
              </div>
            </Tooltip>
            <Tooltip title="Cancel recording">
              <div
                onClick={handleDelete}
                className="ml-1 cursor-pointer rounded p-1 hover:bg-gray-200"
              >
                <TrashIcon
                  className="h-6 w-6 text-gray-400"
                  aria-hidden="true"
                />
              </div>
            </Tooltip>
          </div>

          {/* Floating Live Camera Bubble Overlay during recording */}
          {cameraStream && isCameraEnabled ? (
            <CameraBubbleOverlay
              stream={cameraStream}
              isMuted={isCameraMuted}
              isMirrored={isMirrored}
              bubbleCorner={bubbleCorner}
              bubbleSize={bubbleSize}
              onToggleMute={() => {
                const next = !isCameraMuted;
                setIsCameraMuted(next);
                compositorRef.current?.setCameraMuted(next);
              }}
              onToggleMirror={() => {
                const next = !isMirrored;
                setIsMirrored(next);
                compositorRef.current?.setMirrored(next);
              }}
              onChangeSize={(size) => {
                setBubbleSize(size);
                compositorRef.current?.setBubbleSize(size);
              }}
              onChangeCorner={(corner) => {
                setBubbleCorner(corner);
                setNormalizedPosition(null);
                compositorRef.current?.setCorner(corner);
              }}
              onPositionChange={(pos) => {
                setNormalizedPosition(pos);
                compositorRef.current?.setNormalizedPosition(pos);
              }}
            />
          ) : null}
        </>
      ) : null}

      {step === "post" ? (
        <div>
          {blob ? (
            <div className="mb-3 aspect-video max-h-[75vh] max-w-[75vw]">
              <VideoPlayer video_url={URL.createObjectURL(blob)} />
              <video
                src={URL.createObjectURL(blob)}
                ref={videoRef}
                className="absolute hidden"
              />
            </div>
          ) : null}
          <div className="flex items-center justify-center">
            <button
              type="button"
              className="inline-flex items-center rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold leading-6 text-white shadow transition duration-150 ease-in-out hover:bg-indigo-400 disabled:cursor-not-allowed"
              disabled={submitting}
              onClick={() => void handleUpload()}
            >
              {submitting ? (
                <>
                  <svg
                    className="-ml-1 mr-3 h-5 w-5 animate-spin text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Uploading...
                </>
              ) : (
                <>Save to cloud</>
              )}
            </button>
            <button
              type="button"
              className="ml-2 inline-flex items-center rounded-md px-4 py-2 text-sm font-semibold leading-6 underline transition duration-150 ease-in-out disabled:cursor-not-allowed"
              onClick={() => void handleSave()}
            >
              Download to device
            </button>
            <button
              type="button"
              className="ml-auto inline-flex items-center rounded-md bg-[#dc2625] px-4 py-2 text-sm font-semibold leading-6 text-white shadow transition duration-150 ease-in-out hover:opacity-80 disabled:cursor-not-allowed"
              onClick={() => {
                posthog?.capture("recorder: closed post-modal");
                void closeModal();
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
