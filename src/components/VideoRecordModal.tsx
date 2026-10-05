import { Fragment, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
const Recorder = dynamic(() => import("~/components/Recorder"), { ssr: false });
import dynamic from "next/dynamic";
import { useAtom } from "jotai";
import recordVideoModalOpen from "~/atoms/recordVideoModalOpen";
import { usePostHog } from "posthog-js/react";

export default function VideoRecordModal() {
  const [open, setOpen] = useAtom(recordVideoModalOpen);
  const [step, setStep] = useState<"pre" | "in" | "post">("pre");
  const posthog = usePostHog();

  function closeModal() {
    setStep("pre");
    setOpen(false);
  }

  const handleClose = () => {
    if (step === "pre") closeModal();

    posthog?.capture("cancel video pre-recording");
  };

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-10" onClose={handleClose}>
        {/* backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div
            className={`fixed inset-0 transition-colors ${
              step === "in"
                ? "bg-transparent pointer-events-none"
                : "bg-black bg-opacity-25"
            }`}
          />
        </Transition.Child>

        <div
          className={`fixed inset-0 overflow-y-auto ${
            step === "in" ? "pointer-events-none" : ""
          }`}
        >
          <div
            className={`flex min-h-full p-4 text-center transition-all ${
              step === "in"
                ? "items-end justify-center pb-8"
                : "items-center justify-center"
            }`}
          >
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel
                className={`w-fit pointer-events-auto transform rounded-lg bg-white text-left align-middle shadow-xl transition-all ${
                  step === "in" ? "p-3 shadow-2xl border border-gray-100" : "p-6"
                }`}
              >
                <Recorder
                  closeModal={closeModal}
                  step={step}
                  setStep={setStep}
                />
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
